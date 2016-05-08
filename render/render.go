package render

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"net/http"
	"reflect"
)

func String(w http.ResponseWriter, status int, v string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	w.Write([]byte(v))
}

func HTML(w http.ResponseWriter, status int, v string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	w.Write([]byte(v))
}

func JSON(w http.ResponseWriter, status int, v interface{}) {
	b, err := json.Marshal(v)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if len(b) > 0 {
		b = bytes.Replace(b, []byte("\\u003c"), []byte("<"), -1)
		b = bytes.Replace(b, []byte("\\u003e"), []byte(">"), -1)
		b = bytes.Replace(b, []byte("\\u0026"), []byte("&"), -1)
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	w.Write(b)
}

func Noop(w http.ResponseWriter) {
	String(w, http.StatusOK, "")
}

func XML(w http.ResponseWriter, status int, v interface{}) {
	b, err := xml.Marshal(v)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(status)

	// Try to find <?xml header in first 100 bytes (just in case there're some XML comments).
	findHeaderUntil := len(b)
	if findHeaderUntil > 100 {
		findHeaderUntil = 100
	}
	if bytes.Index(b[:findHeaderUntil], []byte("<?xml")) == -1 {
		// No header found. Print it out first.
		w.Write([]byte(xml.Header))
	}

	w.Write(b)
}

func Respond(w http.ResponseWriter, status int, v interface{}) {
	if err, ok := v.(error); ok {
		JSON(w, status, map[string]interface{}{"error": err.Error()})
		return
	}

	// Force to return empty JSON array [] instead of null in case of zero slice.
	val := reflect.ValueOf(v)
	if val.Kind() == reflect.Slice && val.IsNil() {
		v = reflect.MakeSlice(val.Type(), 0, 0).Interface()
	}

	// TODO: support other types based on request Accept header?
	// render.Respond(ctx, w, 200, data)

	JSON(w, status, v)
}
