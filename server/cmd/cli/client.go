package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	base   string
	token  string
	http   *http.Client
}

func newClient(cfg *Config) *Client {
	return &Client{
		base:  strings.TrimRight(cfg.Server, "/"),
		token: cfg.Token,
		http:  &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) do(method, path string, body any) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.base+"/api/v1"+path, bodyReader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// get decodes a successful JSON response into out.
func (c *Client) get(path string, out any) error {
	return c.getQ(path, nil, out)
}

func (c *Client) getQ(path string, query url.Values, out any) error {
	full := path
	if len(query) > 0 {
		full = path + "?" + query.Encode()
	}
	resp, err := c.do("GET", full, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return checkDecode(resp, out)
}

func (c *Client) post(path string, body, out any) error {
	resp, err := c.do("POST", path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return checkDecode(resp, out)
}

func (c *Client) patch(path string, body, out any) error {
	resp, err := c.do("PATCH", path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return checkDecode(resp, out)
}

func (c *Client) put(path string, body, out any) error {
	resp, err := c.do("PUT", path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return checkDecode(resp, out)
}

func (c *Client) delete(path string) error {
	resp, err := c.do("DELETE", path, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return apiError(resp)
	}
	return nil
}

func checkDecode(resp *http.Response, out any) error {
	if resp.StatusCode >= 400 {
		return apiError(resp)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func apiError(resp *http.Response) error {
	var e struct {
		Error string `json:"error"`
	}
	body, _ := io.ReadAll(resp.Body)
	if json.Unmarshal(body, &e) == nil && e.Error != "" {
		return fmt.Errorf("server error %d: %s", resp.StatusCode, e.Error)
	}
	return fmt.Errorf("server error %d", resp.StatusCode)
}
