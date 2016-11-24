//
// Custom Structured Logger
// ========================
// This example demonstrates how to use middleware.RequestLogger,
// middleware.LogFormatter and middleware.LogEntry to build a structured
// logger using the amazing Sirupsen/logrus package as the logging
// backend.
//
package main

import (
	"fmt"
	"net/http"
	"time"

	"github.com/Sirupsen/logrus"
	"github.com/pressly/chi"
	"github.com/pressly/chi/middleware"
)

func main() {

	// Setup the logger
	logger := logrus.New()
	logger.Formatter = &logrus.JSONFormatter{} // optional / configurable, see docs

	// Routes
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(NewStructuredLogger(logger))
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
	http.ListenAndServe(":3333", r)
}

// StructuredLogger is a simple, but powerful implementation of a custom structured
// logger backed on logrus. I encourage users to copy it, adapt it and make it their
// own. It's well suited to live in its own package, and likely soon I will update
// github.com/goware/lg to use this implementation.

func NewStructuredLogger(logger *logrus.Logger) func(next http.Handler) http.Handler {
	return middleware.RequestLogger(&StructuredLogger{logger})
}

type StructuredLogger struct {
	logger *logrus.Logger
}

func (l *StructuredLogger) NewLogEntry(r *http.Request) middleware.LogEntry {
	entry := &StructuredLoggerEntry{logger: logrus.NewEntry(l.logger)}
	logFields := logrus.Fields{}

	logFields["ts"] = time.Now().UTC().Format(time.RFC1123)

	if reqID := middleware.GetReqID(r.Context()); reqID != "" {
		logFields["req_id"] = reqID
	}

	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	logFields["http_scheme"] = scheme
	logFields["http_proto"] = r.Proto
	logFields["http_method"] = r.Method

	logFields["remote_addr"] = r.RemoteAddr
	logFields["user_agent"] = r.UserAgent()

	logFields["uri"] = fmt.Sprintf("%s://%s%s", scheme, r.Host, r.RequestURI)

	entry.logger = entry.logger.WithFields(logFields)

	entry.logger.Infoln("request started")

	return entry
}

type StructuredLoggerEntry struct {
	logger logrus.FieldLogger
}

func (l *StructuredLoggerEntry) Write(status, bytes int, elapsed time.Duration) {
	l.logger = l.logger.WithFields(logrus.Fields{
		"resp_status": status, "resp_bytes_length": bytes,
		"resp_elasped_ms": float64(elapsed.Nanoseconds()) / 1000000.0,
	})

	if status == middleware.StatusClientClosedRequest {
		l.logger.Infoln("[disconnected]")
		return
	}

	l.logger.Infoln("request complete")
}

func (l *StructuredLoggerEntry) Panic(v interface{}, stack []byte) {
	l.logger = l.logger.WithFields(logrus.Fields{
		"stack": string(stack),
		"panic": fmt.Sprintf("%+v", v),
	})
}

// Helper methods used by the application to get the request-scoped
// logger entry and set additional fields between handlers.
//
// This is a useful pattern to use to set state on the entry as it
// passes through the handler chain, which at any point can be logged
// with a call to .Print(), .Info(), etc.

func GetLogEntry(r *http.Request) logrus.FieldLogger {
	entry := middleware.GetLogEntry(r).(*StructuredLoggerEntry)
	return entry.logger
}

func LogEntrySetField(r *http.Request, key string, value interface{}) {
	entry := middleware.GetLogEntry(r).(*StructuredLoggerEntry)
	entry.logger = entry.logger.WithField(key, value)
	middleware.WithLogEntry(r, entry)
}

func LogEntrySetFields(r *http.Request, fields map[string]interface{}) {
	entry := middleware.GetLogEntry(r).(*StructuredLoggerEntry)
	entry.logger = entry.logger.WithFields(fields)
	middleware.WithLogEntry(r, entry)
}
