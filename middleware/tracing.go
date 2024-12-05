package middleware

import (
	"context"
	"net/http"
)

var (
	TracingCtxKey       = &contextKey{"TracingHeaders"}
	defaultTraceHeaders = []string{
		"X-Cloud-Trace-Context", // GCP load balancer
		"X-Amzn-Trace-Id",       // AWS X-ray
		"CF-ray",                // Cloudflare ray id
	}
)

func Tracing(traceHeaders ...string) func(next http.Handler) http.Handler {
	if len(traceHeaders) == 0 {
		traceHeaders = defaultTraceHeaders
	}
	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			headerValues := map[string]string{}
			for _, header := range traceHeaders {
				val := r.Header.Get(header)
				if val != "" {
					headerValues[header] = val
				}
			}
			if len(headerValues) > 0 {
				r = r.WithContext(context.WithValue(r.Context(), TracingCtxKey, headerValues))
			}

			next.ServeHTTP(w, r)
		}
		return http.HandlerFunc(fn)
	}
}

func AddTracingHeaders(ctx context.Context, r *http.Request) {
	headers, ok := ctx.Value(TracingCtxKey).(map[string]string)
	if ok {
		for key, val := range headers {
			r.Header.Add(key, val)
		}
	}
}
