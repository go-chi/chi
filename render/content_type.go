package render

import (
	"context"
	"net/http"
	"strings"
)

var (
	contentTypeCtxKey = &contextKey{"ContentType"}
)

// A ContentType is an enumeration of HTTP content types.
type ContentType int

const (
	ContentTypePlainText = iota
	ContentTypeHTML
	ContentTypeJSON
	ContentTypeEventStream
	ContentTypeXML
)

// SetContentType is a middleware that forces response Content-Type.
func SetContentType(contentType ContentType) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			r = r.WithContext(context.WithValue(r.Context(), contentTypeCtxKey, contentType))
			next.ServeHTTP(w, r)
		}
		return http.HandlerFunc(fn)
	}
}

func getContentType(r *http.Request) ContentType {
	if contentType, ok := r.Context().Value(contentTypeCtxKey).(ContentType); ok {
		return contentType
	}

	// Parse request Accept header.
	fields := strings.Split(r.Header.Get("Accept"), ",")
	if len(fields) > 0 {
		switch strings.TrimSpace(fields[0]) {
		case "text/plain":
			return ContentTypePlainText
		case "text/html", "application/xhtml+xml":
			return ContentTypeHTML
		case "application/json", "text/javascript":
			return ContentTypeJSON
		case "text/event-stream":
			return ContentTypeEventStream
		case "text/xml", "application/xml":
			return ContentTypeXML
		}
	}

	return ContentTypePlainText // Default Content-Type.
}
