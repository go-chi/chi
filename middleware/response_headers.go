package middleware

import "net/http"

type ResponseHeaders map[string]map[string]string

// AddResponseHeaders middleware adds headers to specified paths
// It accepts a map of headers to add to the response.
// The map should be of the form:
// 		{
// 			"/path/to/resource": {
// 				"Header-Name": "Header-Value",
// 				"Header-Name2": "Header-Value",
// 			},
// 			"/path/to/resource2": {
// 				"Header-Name": "Header-Value",
// 				"Header-Name2": "Header-Value",
// 			},
// 		}
// Example:
// 		responseHeaders = middleware.ResponseHeaders{
// 			"/testing": {
// 				"X-Test-Header": "Test-Value",
// 			},
// 		}
//		r.Use(middleware.AddResponseHeaders(responseHeaders))
func AddResponseHeaders(responseHeaders ResponseHeaders) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			if headers, ok := responseHeaders[r.URL.Path]; ok {
				for k, v := range headers {
					w.Header().Set(k, v)
				}
			}
		}
		return http.HandlerFunc(fn)
	}
}
