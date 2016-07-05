package render

import (
	"bytes"
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
	if status, ok := r.Context().Value(statusCtxKey).(int); ok {
		w.WriteHeader(status)
	}

	w.Write([]byte(v))
}

func HTML(w http.ResponseWriter, r *http.Request, v string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if status, ok := r.Context().Value(statusCtxKey).(int); ok {
		w.WriteHeader(status)
	}

	w.Write([]byte(v))
}

func JSON(w http.ResponseWriter, r *http.Request, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if status, ok := r.Context().Value(statusCtxKey).(int); ok {
		w.WriteHeader(status)
	}

	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(true)
	if err := enc.Encode(v); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
}

func XML(w http.ResponseWriter, r *http.Request, v interface{}) {
	b, err := xml.Marshal(v)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	if status, ok := r.Context().Value(statusCtxKey).(int); ok {
		w.WriteHeader(status)
	}

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

func NoContent(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(204)
}
