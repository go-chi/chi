// Package response provides useful helpers for encoding response body and setting Content-Type automatically.
package response

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
)

// NoContent writes the status code and sets the Content-Length header to 0
func NoContent(w http.ResponseWriter, code int) {
	w.WriteHeader(code)
	w.Header().Set(`Content-Length`, `0`)
}

// String writes s to the body and sets the Content-Type to text/plain
func String(w http.ResponseWriter, code int, s string) {
	w.WriteHeader(code)
	w.Header().Set(`Content-Type`, `text/plain`)
	if _, err := w.Write([]byte(s)); err != nil {
		panic(err)
	}
}

// JSON writes v to the body as JSON and sets the Content-Type to application/json. If marshalling fails, it panics.
func JSON(w http.ResponseWriter, code int, v any) {
	w.WriteHeader(code)
	w.Header().Set(`Content-Type`, `application/json`)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		panic(fmt.Errorf(`error encoding JSON into response: %w`, err))
	}
}

// XML writes v to the body as XML and sets the Content-Type to application/xml. If marshalling fails, it panics.
func XML(w http.ResponseWriter, code int, v any) {
	w.WriteHeader(code)
	w.Header().Set(`Content-Type`, `application/xml`)
	if err := xml.NewEncoder(w).Encode(v); err != nil {
		panic(fmt.Errorf(`error encoding XML into response: %w`, err))
	}
}

// StreamBlob copies data from r to w and sets the Content-Type to application/octet-stream
func StreamBlob(w http.ResponseWriter, code int, r io.Reader) {
	w.WriteHeader(code)
	w.Header().Set(`Content-Type`, `application/octet-stream`)
	if _, err := io.Copy(w, r); err != nil {
		panic(fmt.Errorf(`error streaming blob into response: %w`, err))
	}
}

// Blob writes v to the body and sets the Content-Type to application/octet-stream
func Blob(w http.ResponseWriter, code int, v []byte) {
	w.WriteHeader(code)
	w.Header().Set(`Content-Type`, `application/octet-stream`)
	if _, err := w.Write(v); err != nil {
		panic(fmt.Errorf(`error writing blob into response: %w`, err))
	}
}
