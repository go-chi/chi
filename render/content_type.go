package render

import (
	"context"
	"net/http"
	"strings"
)

var (
	ContentTypeCtxKey = &contextKey{"ContentType"}
)

// ContentType is an enumeration of common HTTP content types.
type ContentType int

// ContentTypes handled by this package.
const (
	ContentTypeUnknown = iota
	ContentTypePlainText
	ContentTypeHTML
	ContentTypeJSON
	ContentTypeXML
	ContentTypeForm
	ContentTypeEventStream
)

func GetContentType(s string) ContentType {
	switch s {
	case "text/plain":
		return ContentTypePlainText
	case "text/html", "application/xhtml+xml":
		return ContentTypeHTML
	case "application/json", "text/javascript":
		return ContentTypeJSON
	case "text/xml", "application/xml":
		return ContentTypeXML
	case "application/x-www-form-urlencoded":
		return ContentTypeForm
	case "text/event-stream":
		return ContentTypeEventStream
	default:
		return ContentTypeUnknown
	}
}

// SetContentType is a middleware that forces response Content-Type.
func SetContentType(contentType ContentType) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			r = r.WithContext(context.WithValue(r.Context(), ContentTypeCtxKey, contentType))
			next.ServeHTTP(w, r)
		}
		return http.HandlerFunc(fn)
	}
}

// GetRequestContentType is a helper function that returns ContentType based on
// context or request headers.
func GetRequestContentType(r *http.Request) ContentType {
	if contentType, ok := r.Context().Value(ContentTypeCtxKey).(ContentType); ok {
		return contentType
	}
	return GetContentType(r.Header.Get("Content-Type"))
}

func GetAcceptedContentType(r *http.Request) ContentType {
	if contentType, ok := r.Context().Value(ContentTypeCtxKey).(ContentType); ok {
		return contentType
	}

	var contentType ContentType

	// Parse request Accept header.
	fields := strings.Split(r.Header.Get("Accept"), ",")
	if len(fields) > 0 {
		contentType = GetContentType(strings.TrimSpace(fields[0]))
	}

	if contentType == ContentTypeUnknown {
		contentType = ContentTypePlainText
	}
	return contentType
}
