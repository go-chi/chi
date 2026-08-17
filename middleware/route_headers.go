package middleware

import (
	"net/http"
	"strings"
)

// RouteHeaders is a neat little header-based router that allows you to direct
// the flow of a request through a middleware stack based on a request header.
//
// For example, lets say you'd like to setup multiple routers depending on the
// request Host header, you could then do something as so:
//
//	r := chi.NewRouter()
//	rSubdomain := chi.NewRouter()
//	r.Use(middleware.RouteHeaders().
//		Route("Host", "example.com", middleware.New(r)).
//		Route("Host", "*.example.com", middleware.New(rSubdomain)).
//		Handler)
//	r.Get("/", h)
//	rSubdomain.Get("/", h2)
//
// Another example, imagine you want to setup multiple CORS handlers, where for
// your origin servers you allow authorized requests, but for third-party public
// requests, authorization is disabled.
//
//	r := chi.NewRouter()
//	r.Use(middleware.RouteHeaders().
//		Route("Origin", "https://app.skyweaver.net", cors.Handler(cors.Options{
//			AllowedOrigins:   []string{"https://api.skyweaver.net"},
//			AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
//			AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
//			AllowCredentials: true, // <----------<<< allow credentials
//		})).
//		Route("Origin", "*", cors.Handler(cors.Options{
//			AllowedOrigins:   []string{"*"},
//			AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
//			AllowedHeaders:   []string{"Accept", "Content-Type"},
//			AllowCredentials: false, // <----------<<< do not allow credentials
//		})).
//		Handler)
func RouteHeaders() HeaderRouter {
	return HeaderRouter{}
}

// HeaderRouter maps a lowercased request header name to the routes registered
// for it. Use [RouteHeaders] to create one.
type HeaderRouter map[string][]HeaderRoute

// Route registers middlewareHandler for requests whose header value matches
// match, which may contain a single "*" wildcard. The header name is matched
// case-insensitively.
//
// The header value is lowercased before it is compared, but match is not, so
// match should be lowercase: "example.com" matches both "example.com" and
// "EXAMPLE.COM", while "Example.com" never matches anything.
//
// It returns hr so that calls can be chained.
func (hr HeaderRouter) Route(header, match string, middlewareHandler func(next http.Handler) http.Handler) HeaderRouter {
	header = strings.ToLower(header)
	k := hr[header]
	if k == nil {
		hr[header] = []HeaderRoute{}
	}
	hr[header] = append(hr[header], HeaderRoute{MatchOne: NewPattern(match), Middleware: middlewareHandler})
	return hr
}

// RouteAny works like [HeaderRouter.Route], but registers one middlewareHandler
// for several patterns at once. The route matches when any of them matches.
//
// It returns hr so that calls can be chained.
func (hr HeaderRouter) RouteAny(header string, match []string, middlewareHandler func(next http.Handler) http.Handler) HeaderRouter {
	header = strings.ToLower(header)
	k := hr[header]
	if k == nil {
		hr[header] = []HeaderRoute{}
	}
	patterns := []Pattern{}
	for _, m := range match {
		patterns = append(patterns, NewPattern(m))
	}
	hr[header] = append(hr[header], HeaderRoute{MatchAny: patterns, Middleware: middlewareHandler})
	return hr
}

// RouteDefault registers the handler to use when no other route matches. It
// replaces any default registered earlier.
//
// It returns hr so that calls can be chained.
func (hr HeaderRouter) RouteDefault(handler func(next http.Handler) http.Handler) HeaderRouter {
	hr["*"] = []HeaderRoute{{Middleware: handler}}
	return hr
}

// Handler returns the middleware that performs the routing. The first route
// whose pattern matches the value of its header handles the request. If none
// match, the handler registered with [HeaderRouter.RouteDefault] runs, and if
// there is no default the request is passed to next unchanged.
//
// Headers are visited in map order, so when a request could match routes on
// more than one header, which of them wins is not defined.
func (hr HeaderRouter) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(hr) == 0 {
			// skip if no routes set
			next.ServeHTTP(w, r)
			return
		}

		// find first matching header route, and continue
		for header, matchers := range hr {
			headerValue := r.Header.Get(header)
			if headerValue == "" {
				continue
			}
			headerValue = strings.ToLower(headerValue)
			for _, matcher := range matchers {
				if matcher.IsMatch(headerValue) {
					matcher.Middleware(next).ServeHTTP(w, r)
					return
				}
			}
		}

		// if no match, check for "*" default route
		matcher, ok := hr["*"]
		if !ok || matcher[0].Middleware == nil {
			next.ServeHTTP(w, r)
			return
		}
		matcher[0].Middleware(next).ServeHTTP(w, r)
	})
}

// HeaderRoute is a single route registered on a [HeaderRouter]. MatchAny takes
// precedence: MatchOne is only consulted when MatchAny is empty.
type HeaderRoute struct {
	Middleware func(next http.Handler) http.Handler
	MatchOne   Pattern
	MatchAny   []Pattern
}

// IsMatch reports whether value matches the route. When MatchAny is set it
// matches if any of its patterns match, otherwise MatchOne is used.
func (r HeaderRoute) IsMatch(value string) bool {
	if len(r.MatchAny) > 0 {
		for _, m := range r.MatchAny {
			if m.Match(value) {
				return true
			}
		}
	} else if r.MatchOne.Match(value) {
		return true
	}
	return false
}

// Pattern matches a header value, optionally through a single "*" wildcard.
// Use [NewPattern] to build one.
type Pattern struct {
	prefix   string
	suffix   string
	wildcard bool
}

// NewPattern compiles value into a [Pattern]. The first "*" in value becomes a
// wildcard that matches any run of characters, so "*.example.com" matches
// "api.example.com". A second "*" is matched literally.
func NewPattern(value string) Pattern {
	p := Pattern{}
	p.prefix, p.suffix, p.wildcard = strings.Cut(value, "*")
	return p
}

// Match reports whether v satisfies the pattern. Without a wildcard this is an
// exact comparison. With one, v must be long enough to hold both sides and must
// start with the part before the "*" and end with the part after it.
func (p Pattern) Match(v string) bool {
	if !p.wildcard {
		return p.prefix == v
	}
	return len(v) >= len(p.prefix+p.suffix) && strings.HasPrefix(v, p.prefix) && strings.HasSuffix(v, p.suffix)
}
