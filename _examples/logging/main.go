// Custom Structured Logger
// ========================
// This example demonstrates how to use middleware.RequestLogger,
// middleware.LogFormatter and middleware.LogEntry to build a structured
// logger using the preview version of the new log/slog package as the logging
// backend.
//
// Also: check out https://github.com/goware/httplog for an improved context
// logger with support for HTTP request logging, based on the example below.
package main

import (
	"fmt"
	"net/http"
	"os"
	"reflect"
	"time"

	"log/slog"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func main() {
	// Setup a handler for the new log/slog library. If isJson is true,
	// handler will be a JSONHandler and Panic() will print stack as a
	// JSON string value. If isJson is false, handler will be a TextHandler
	// and Panic() will pretty print the stack trace.
	var isJson bool
	isJson = false
	slogHandler := NewSlogHandler(isJson)

	// Routes
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(NewStructuredLogger(slogHandler))
	r.Use(middleware.Recoverer)

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("welcome"))
	})
	r.Get("/wait", func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(1 * time.Second)
		LogEntrySetField(r, "wait", true)
		w.Write([]byte("hi"))
	})
	r.Get("/panic", func(w http.ResponseWriter, r *http.Request) {
		panic("oops")
	})
	r.Get("/add_fields", func(w http.ResponseWriter, r *http.Request) {
		LogEntrySetFields(r, map[string]interface{}{"foo": "bar", "bar": "foo"})
	})
	http.ListenAndServe(":3333", r)
}

// NewSlogHandler returns a slog.JSONHandler or slog.TextHandler, depending on the provided boolean
func NewSlogHandler(isJson bool) slog.Handler {
	opts := &slog.HandlerOptions{
		// Remove default time slog.Attr, we create our own later
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			if a.Key == slog.TimeKey {
				return slog.Attr{}
			}
			return a
		},
	}
	if isJson {
		return slog.NewJSONHandler(os.Stdout, opts)
	}
	return slog.NewTextHandler(os.Stdout, opts)
}

// StructuredLogger is a simple, but powerful implementation of a custom structured
// logger backed on log/slog. I encourage users to copy it, adapt it and make it their
// own. Also take a look at https://github.com/go-chi/httplog for a dedicated pkg based
// on this work, designed for context-based http routers.

func NewStructuredLogger(handler slog.Handler) func(next http.Handler) http.Handler {
	return middleware.RequestLogger(&StructuredLogger{Logger: handler})
}

type StructuredLogger struct {
	Logger slog.Handler
}

func (l *StructuredLogger) NewLogEntry(r *http.Request) middleware.LogEntry {
	var logFields []slog.Attr
	logFields = append(logFields, slog.String("ts", time.Now().UTC().Format(time.RFC1123)))

	if reqID := middleware.GetReqID(r.Context()); reqID != "" {
		logFields = append(logFields, slog.String("req_id", reqID))
	}

	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}

	handler := l.Logger.WithAttrs(append(logFields,
		slog.String("http_scheme", scheme),
		slog.String("http_proto", r.Proto),
		slog.String("http_method", r.Method),
		slog.String("remote_addr", r.RemoteAddr),
		slog.String("user_agent", r.UserAgent()),
		slog.String("uri", fmt.Sprintf("%s://%s%s", scheme, r.Host, r.RequestURI))))

	entry := StructuredLoggerEntry{Logger: slog.New(handler)}

	entry.Logger.Info("request started")

	return &entry
}

type StructuredLoggerEntry struct {
	Logger *slog.Logger
}

func (l *StructuredLoggerEntry) Write(status, bytes int, header http.Header, elapsed time.Duration, extra interface{}) {
	l.Logger.With(slog.Int("resp_status", status),
		slog.Int("resp_byte_length", bytes),
		slog.Float64("resp_elapsed_ms", float64(elapsed.Nanoseconds())/1000000.0)).Info("request complete")
}

func (l *StructuredLoggerEntry) Panic(v interface{}, stack []byte) {
	if reflect.TypeOf(l.Logger.Handler()) == reflect.TypeOf(&slog.JSONHandler{}) {
		l.Logger.With(slog.String("stack", string(stack))).Error(fmt.Sprintf("%+v", v))
	} else {
		middleware.PrintPrettyStack(v)
	}
}

// Helper methods used by the application to get the request-scoped
// logger entry and set additional fields between handlers.
//
// This is a useful pattern to use to set state on the entry as it
// passes through the handler chain, which at any point can be logged
// with a call to .Print(), .Info(), etc.

func GetLogEntry(r *http.Request) *slog.Logger {
	entry := middleware.GetLogEntry(r).(*StructuredLoggerEntry)
	return entry.Logger
}

func LogEntrySetField(r *http.Request, key string, value interface{}) {
	if entry, ok := r.Context().Value(middleware.LogEntryCtxKey).(*StructuredLoggerEntry); ok {
		entry.Logger = entry.Logger.With(key, value)
	}
}

func LogEntrySetFields(r *http.Request, fields map[string]interface{}) {
	if entry, ok := r.Context().Value(middleware.LogEntryCtxKey).(*StructuredLoggerEntry); ok {
		for k, v := range fields {
			entry.Logger = entry.Logger.With(k, v)
		}
	}
}
