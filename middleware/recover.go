package middleware

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"strings"
)

// Recover middleware catches a panic and passes the value and a stack trace to f.
func Recover(f func(w http.ResponseWriter, r *http.Request, panicValue any, stack []StackTraceEntry)) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww := &statusWriter{ResponseWriter: w}

			defer func() {
				v := recover()
				if err, _ := v.(error); errors.Is(err, http.ErrAbortHandler) {
					panic(v)
				}
				if v != nil {
					stack := getPanicStack()

					if f != nil {
						f(ww, r, v, stack)
					}

					if ww.code == 0 {
						w.WriteHeader(http.StatusInternalServerError)
					}
				}
			}()

			next.ServeHTTP(ww, r)
		})
	}
}

// DefaultPanicLogger writes formatted panic logs with a stack trace to the specified output.
func DefaultPanicLogger(dst io.Writer) func(http.ResponseWriter, *http.Request, any, []StackTraceEntry) {
	if dst == nil {
		panic(`panic log Writer may not be nil`)
	}

	return func(w http.ResponseWriter, r *http.Request, panicValue any, stack []StackTraceEntry) {
		var msg strings.Builder
		msg.WriteString(fmt.Sprintf("%s %q - panic: %v\n", r.Method, r.URL.Path, panicValue))
		for _, frame := range stack {
			msg.WriteString(fmt.Sprintf("\t%s\n\t\t%s:%d\n", frame.Function, frame.File, frame.Line))
		}
		fmt.Fprintln(dst, msg.String())

		w.WriteHeader(http.StatusInternalServerError)
	}
}

// StackTraceEntry is an entry in the stack trace
type StackTraceEntry struct {
	Function string `json:"function"`
	File     string `json:"file"`
	Line     int    `json:"line"`
}

func getPanicStack() []StackTraceEntry {
	stackTrace := []StackTraceEntry{}

	pc := make([]uintptr, 50)
	entries := runtime.Callers(2, pc)
	frames := runtime.CallersFrames(pc[:entries])

	for frame, more := frames.Next(); more; frame, more = frames.Next() {
		if frame.Function == `runtime.gopanic` { // If a panic occurred, start at the frame that called panic
			stackTrace = nil
			continue
		}

		parts := strings.Split(frame.Function, `/vendor/`)
		f := parts[len(parts)-1]

		stackTrace = append(stackTrace, StackTraceEntry{Function: f, File: frame.File, Line: frame.Line})
	}

	return stackTrace
}
