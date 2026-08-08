// gqlproxy is a sidecar used by the TypeScript provider layer.
// Investing.com blocks Node's TLS fingerprint (HTTP 403) while Go's TLS stack
// is accepted. It also issues Cloudflare challenge cookies, so this proxy
// maintains a persistent cookie jar (bootstrapped from the chart page) and
// retries once after re-bootstrapping when challenged.
//
// Usage: gqlproxy -cookiefile <path> <url>
// stdin:  JSON {"method":"POST","headers":{...},"body":"..."}
// stdout: JSON {"status":200,"body":"..."}
package main

import (
	"bufio"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const chartPage = "https://www.investing.com/equities/nvidia-corp-chart"
const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"

type proxyReq struct {
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

type proxyResp struct {
	Status int    `json:"status"`
	Body   string `json:"body"`
}

type cookieStore struct {
	mu      sync.Mutex
	path    string
	cookies map[string]string
}

func newCookieStore(path string) *cookieStore {
	s := &cookieStore{path: path, cookies: map[string]string{}}
	if path != "" {
		s.load()
	}
	return s
}

func (s *cookieStore) load() {
	f, err := os.Open(s.path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		kv := strings.SplitN(line, "=", 2)
		if len(kv) == 2 {
			s.cookies[kv[0]] = kv[1]
		}
	}
}

func (s *cookieStore) save() {
	if s.path == "" {
		return
	}
	dir := filepath.Dir(s.path)
	if dir != "" && dir != "." {
		os.MkdirAll(dir, 0o755)
	}
	keys := make([]string, 0, len(s.cookies))
	for k := range s.cookies {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		b.WriteString(k)
		b.WriteString("=")
		b.WriteString(s.cookies[k])
		b.WriteString("\n")
	}
	os.WriteFile(s.path, []byte(b.String()), 0o600)
}

func (s *cookieStore) header() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := make([]string, 0, len(s.cookies))
	for k := range s.cookies {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+s.cookies[k])
	}
	return strings.Join(parts, "; ")
}

func (s *cookieStore) absorb(setCookies []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range setCookies {
		kv := strings.SplitN(c, "=", 2)
		if len(kv) != 2 {
			continue
		}
		val := strings.SplitN(kv[1], ";", 2)[0]
		if val != "" {
			s.cookies[kv[0]] = val
		}
	}
}

func newClient() *http.Client {
	tr := &http.Transport{
		TLSClientConfig:   &tls.Config{},
		ForceAttemptHTTP2: false,
		MaxIdleConns:      10,
		IdleConnTimeout:   90 * time.Second,
	}
	return &http.Client{Timeout: 45 * time.Second, Transport: tr}
}

func chartHeaders() map[string]string {
	return map[string]string{
		"user-agent":       ua,
		"sec-ch-ua":        "\"Chromium\";v=\"148\", \"Google Chrome\";v=\"148\", \"Not/A)Brand\";v=\"99\"",
		"sec-ch-ua-mobile": "?0",
		"sec-ch-ua-platform": "\"Windows\"",
		"dnt":              "1",
	}
}

func bootstrap(client *http.Client, store *cookieStore) (int, error) {
	req, err := http.NewRequest("GET", chartPage, nil)
	if err != nil {
		return 0, err
	}
	for k, v := range chartHeaders() {
		req.Header.Set(k, v)
	}
	if c := store.header(); c != "" {
		req.Header.Set("Cookie", c)
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	store.absorb(resp.Header.Values("Set-Cookie"))
	store.save()
	return resp.StatusCode, nil
}

func doRequest(client *http.Client, store *cookieStore, r proxyReq, url string) proxyResp {
	var body io.Reader
	if r.Body != "" {
		body = strings.NewReader(r.Body)
	}
	method := r.Method
	if method == "" {
		method = "GET"
	}
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return proxyResp{Status: 0, Body: err.Error()}
	}
	for k, v := range r.Headers {
		req.Header.Set(k, v)
	}
	if c := store.header(); c != "" {
		req.Header.Set("Cookie", c)
	}
	res, err := client.Do(req)
	if err != nil {
		return proxyResp{Status: 0, Body: err.Error()}
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, 24<<20))
	store.absorb(res.Header.Values("Set-Cookie"))
	store.save()
	return proxyResp{Status: res.StatusCode, Body: string(b)}
}

func main() {
	cookieFile := flag.String("cookiefile", "", "path to persistent cookie jar")
	flag.Parse()
	if flag.NArg() < 1 {
		fmt.Fprintln(os.Stderr, "usage: gqlproxy -cookiefile <path> <url>")
		os.Exit(2)
	}
	url := flag.Arg(0)

	var r proxyReq
	if err := json.NewDecoder(os.Stdin).Decode(&r); err != nil {
		fmt.Fprintln(os.Stderr, "bad input:", err)
		os.Exit(2)
	}

	store := newCookieStore(*cookieFile)
	client := newClient()

	out := doRequest(client, store, r, url)
	if out.Status == 403 {
		// Re-bootstrap the Cloudflare session and retry once.
		if _, err := bootstrap(client, store); err == nil {
			out = doRequest(client, store, r, url)
		}
	}
	enc, _ := json.Marshal(out)
	fmt.Println(string(enc))
}
