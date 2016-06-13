package render

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"net/http"
	"reflect"

	"golang.org/x/net/context"
)

var Respond = DefaultRespond

func DefaultRespond(ctx context.Context, w http.ResponseWriter, v interface{}) {
	// Present the object.
	if presenter, ok := ctx.Value(presenterCtxKey).(Presenter); ok {
		v = presenter.Present(ctx, v)
	} else {
		v = DefaultPresenter.Present(ctx, v)
	}

	// Format data based on Content-Type.
	switch contentType, _ := ctx.Value(contentTypeCtxKey).(ContentType); contentType {
	case ContentTypeJSON:
		JSON(ctx, w, v)
	case ContentTypeXML:
		XML(ctx, w, v)
	default:
		JSON(ctx, w, v)
	}
}

func String(ctx context.Context, w http.ResponseWriter, v string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	status, _ := ctx.Value(statusCtxKey).(int)
	if status == 0 {
		status = 200
	}
	w.WriteHeader(status)
	w.Write([]byte(v))
}

func HTML(ctx context.Context, w http.ResponseWriter, v string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	status, _ := ctx.Value(statusCtxKey).(int)
	if status == 0 {
		status = 200
	}
	w.WriteHeader(status)
	w.Write([]byte(v))
}

func JSON(ctx context.Context, w http.ResponseWriter, v interface{}) {
	// Force to return empty JSON array [] instead of null in case of zero slice.
	val := reflect.ValueOf(v)
	if val.Kind() == reflect.Slice && val.IsNil() {
		v = reflect.MakeSlice(val.Type(), 0, 0).Interface()
	}

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
	status, _ := ctx.Value(statusCtxKey).(int)
	if status == 0 {
		status = 200
	}
	w.WriteHeader(status)
	w.Write(b)
}

func XML(ctx context.Context, w http.ResponseWriter, v interface{}) {
	b, err := xml.Marshal(v)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	status, _ := ctx.Value(statusCtxKey).(int)
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

func Status(ctx context.Context, status int) context.Context {
	return context.WithValue(ctx, statusCtxKey, status)
}
