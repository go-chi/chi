package raml

import (
	"fmt"
	"strings"
)

var Header = `#%RAML 0.8
---
`

type RAML struct {
	Title         string          `yaml:"title,omitempty"`
	BaseUri       string          `yaml:"baseUri,omitempty"`
	Protocols     []string        `yaml:"protocols,omitempty"`
	MediaType     string          `yaml:"mediaType,omitempty"`
	Version       string          `yaml:"version,omitempty"`
	Documentation []Documentation `yaml:"documentation,omitempty"`

	Records `yaml:",inline"`
}

type Documentation struct {
	Title   string `yaml:"title"`
	Content string `yaml:"content"`
}

type Records map[string]Record

type Record struct {
	DisplayName     string    `yaml:"displayName,omitempty"`
	Description     string    `yaml:"description,omitempty"`
	Responses       Responses `yaml:"responses,omitempty"`
	Body            string    `yaml:"body,omitempty"`
	Is              []string  `yaml:"is,omitempty"`
	Type            string    `yaml:"type,omitempty"`
	SecuredBy       []string  `yaml:"securedBy,omitempty"`
	UriParameters   []string  `yaml:"uirParameters,omitempty"`
	QueryParameters []string  `yaml:"queryParameters,omitempty"`

	Records `yaml:",inline"`
}

type Responses map[int]Response

type Response struct {
	Body string `yaml:"body,omitempty"`
}

func (r *RAML) Add(method string, route string, record Record) error {
	if r.Records == nil {
		r.Records = Records{}
	}
	return r.Records.add(method, route, record)
}

func (r Records) add(method string, route string, record Record) error {
	// Find or create node tree based on a given route.
	parentNode := r
	parts := strings.Split(route, "/")
	for _, part := range parts[:len(parts)-1] {
		if part == "" || part == "*" {
			// TODO: Should we get rid of these '*' routes in Walk()?
			continue
		}

		node, found := parentNode["/"+part]
		if !found {
			// Zero struct value, init maps.
			node.Records = Records{}
			node.Responses = Responses{}

			parentNode["/"+part] = node
			parentNode = node.Records
			continue
		}
		parentNode = node.Records
	}

	// Upsert the last node.
	part := parts[len(parts)-1]
	node, found := parentNode["/"+part]
	if !found {
		// Zero struct value, init maps.
		node.Records = Records{}
		node.Responses = Responses{}
	}

	method = strings.ToLower(method)
	if _, found := node.Records[method]; found {
		return fmt.Errorf("duplicated method route: %v %v", method, route)
	}

	node.Records[method] = record
	parentNode["/"+part] = node

	return nil
}
