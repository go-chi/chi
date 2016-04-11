package render

import (
	"net/http"
	"strings"
	"context"
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

func ParseContentType(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var contentType ContentType

		// Parse request Accept header.
		fields := strings.Split(r.Header.Get("Accept"), ",")
		if len(fields) > 0 {
			switch strings.TrimSpace(fields[0]) {
			case "text/plain":
				contentType = ContentTypePlainText
			case "text/html", "application/xhtml+xml":
				contentType = ContentTypeHTML
			case "application/json", "text/javascript":
				contentType = ContentTypeJSON
			case "text/event-stream":
				contentType = ContentTypeEventStream
			case "text/xml":
				contentType = ContentTypeXML
			default:
				contentType = ContentTypeJSON
			}
		}

		// Explicitly requested stream.
		if _, ok := r.URL.Query()["stream"]; ok {
			contentType = ContentTypeEventStream
		}

		// TODO: use a ContentTypeCtxKey value....?
		ctx := context.WithValue(r.Context(), "contentType", contentType)
		r = r.WithContext(ctx)

		next.ServeHTTP(w, r)
	})
}
