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

type HeaderRouter map[string][]HeaderRoute

func (hr HeaderRouter) Route(header, match string, middlewareHandler func(next http.Handler) http.Handler) HeaderRouter {
	header = strings.ToLower(header)
	k := hr[header]
	if k == nil {
		hr[header] = []HeaderRoute{}
	}
	hr[header] = append(hr[header], HeaderRoute{MatchOne: NewPattern(match), Middleware: middlewareHandler})
	return hr
}

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

func (hr HeaderRouter) RouteDefault(handler func(next http.Handler) http.Handler) HeaderRouter {
	hr["*"] = []HeaderRoute{{Middleware: handler}}
	return hr
}

func (hr HeaderRouter) Handler(next http.Handler) http.Handler {
	routes := make(map[string][]headerRouteHandler, len(hr))
	for header, matchers := range hr {
		for _, matcher := range matchers {
			var handler http.Handler
			if matcher.Middleware != nil {
				handler = matcher.Middleware(next)
			}
			routes[header] = append(routes[header], headerRouteHandler{matcher, handler})
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if len(routes) == 0 {
			// skip if no routes set
			next.ServeHTTP(w, r)
			return
		}

		// find first matching header route, and continue
		for header, matchers := range routes {
			headerValue := r.Header.Get(header)
			if headerValue == "" {
				continue
			}
			headerValue = strings.ToLower(headerValue)
			for _, matcher := range matchers {
				if matcher.IsMatch(headerValue) {
					matcher.handler.ServeHTTP(w, r)
					return
				}
			}
		}

		// if no match, check for "*" default route
		matcher, ok := routes["*"]
		if !ok || matcher[0].handler == nil {
			next.ServeHTTP(w, r)
			return
		}
		matcher[0].handler.ServeHTTP(w, r)
	})
}

type headerRouteHandler struct {
	HeaderRoute
	handler http.Handler
}

type HeaderRoute struct {
	Middleware func(next http.Handler) http.Handler
	MatchOne   Pattern
	MatchAny   []Pattern
}

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

type Pattern struct {
	prefix   string
	suffix   string
	wildcard bool
}

func NewPattern(value string) Pattern {
	p := Pattern{}
	p.prefix, p.suffix, p.wildcard = strings.Cut(value, "*")
	return p
}

func (p Pattern) Match(v string) bool {
	if !p.wildcard {
		return p.prefix == v
	}
	return len(v) >= len(p.prefix+p.suffix) && strings.HasPrefix(v, p.prefix) && strings.HasSuffix(v, p.suffix)
}
