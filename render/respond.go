package render

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"net/http"
)

var Respond = DefaultRespond

func DefaultRespond(w http.ResponseWriter, r *http.Request, v interface{}) {
	// Present the object.
	if presenter, ok := r.Context().Value(presenterCtxKey).(Presenter); ok {
		v = presenter.Present(r, v)
	} else {
		v = DefaultPresenter.Present(r, v)
	}

	// Format data based on Content-Type.
	switch getContentType(r) {
	case ContentTypeJSON:
		JSON(w, r, v)
	case ContentTypeXML:
		XML(w, r, v)
	default:
		JSON(w, r, v)
	}
}

func PlainText(w http.ResponseWriter, r *http.Request, v string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	status, _ := r.Context().Value(statusCtxKey).(int)
	if status == 0 {
		status = 200
	}
	w.WriteHeader(status)
	w.Write([]byte(v))
}

func HTML(w http.ResponseWriter, r *http.Request, v string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	status, _ := r.Context().Value(statusCtxKey).(int)
	if status == 0 {
		status = 200
	}
	w.WriteHeader(status)
	w.Write([]byte(v))
}

func JSON(w http.ResponseWriter, r *http.Request, v interface{}) {
	// TODO: go1.7
	// enc := json.NewEncoder(w)
	// enc.SetEscapeHTML(true)
	// if err := enc.Encode(v); err != nil {
	// 	http.Error(w, err.Error(), http.StatusInternalServerError)
	// 	return
	// }

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
	status, _ := r.Context().Value(statusCtxKey).(int)
	if status == 0 {
		status = 200
	}
	w.WriteHeader(status)
	w.Write(b)
}

func XML(w http.ResponseWriter, r *http.Request, v interface{}) {
	b, err := xml.Marshal(v)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	status, _ := r.Context().Value(statusCtxKey).(int)
	if status == 0 {
		status = 200
	}
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

func Status(r *http.Request, status int) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), statusCtxKey, status))
}
