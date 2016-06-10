package render

import (
	"context"
	"net/http"
	"strings"
)

// A ContentType is an enumeration of HTTP content types.
type ContentType int

const (
	ContentTypeJSON = iota
	ContentTypeEventStream
	ContentTypeXML
)

type ctxKey int

const ContentTypeCtxKey ctxKey = iota

// TODO: is this middleware still useful? if render.Respond()
// accepted the type somehow, then its less important.
// perhaps we keep it, and pass ctx as first argument..?
// or... make signature: render.Respond(w, r, status, data)

func ParseContentType(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var contentType ContentType

		// Parse request Accept header.
		fields := strings.Split(r.Header.Get("Accept"), ",")
		if len(fields) > 0 {
			switch strings.TrimSpace(fields[0]) {
			// case "text/plain":
			// 	contentType = ContentTypePlainText
			// case "text/html", "application/xhtml+xml":
			// 	contentType = ContentTypeHTML
			case "application/json", "text/javascript":
				contentType = ContentTypeJSON
			case "text/event-stream":
				contentType = ContentTypeEventStream
			case "text/xml", "application/xml":
				contentType = ContentTypeXML
			default:
				contentType = ContentTypeJSON
			}
		}

		// Explicitly requested stream.
		if _, ok := r.URL.Query()["stream"]; ok {
			contentType = ContentTypeEventStream
		}

		ctx := context.WithValue(r.Context(), ContentTypeCtxKey, contentType)
		r = r.WithContext(ctx)

		next.ServeHTTP(w, r)
	})
}
