package middleware

import (
	"net/http"
	"regexp"
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
// Another example, lets say you'd like to route through some middleware based on
// presence of specific cookie and in request there are multiple cookies e.g.
// "firstcookie=one; secondcookie=two; thirdcookie=three", then you might use
// RouteHeadersContainsMatcher to be able to route this request:
//
//	 r := chi.NewRouter()
//	 routeMiddleware := middleware.RouteHeaders().
//			SetMatcherType(middleware.RouteHeadersContainsMatcher).
//			Route("Cookie", "secondcookie", MyCustomMiddleware).
//			Handler
//
//	 r.Use(routeMiddleware)
//	 r.Get("/", h)
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
func RouteHeaders() *HeaderRouter {
	return &HeaderRouter{
		routes:       map[string][]HeaderRoute{},
		matchingType: RouteHeadersClassicMatcher,
	}
}

type MatcherType int

const (
	RouteHeadersClassicMatcher MatcherType = iota
	RouteHeadersContainsMatcher
	RouteHeadersRegexMatcher
)

type HeaderRouter struct {
	routes       map[string][]HeaderRoute
	matchingType MatcherType
}

func (hr *HeaderRouter) SetMatchingType(matchingType MatcherType) *HeaderRouter {
	hr.matchingType = matchingType
	return hr
}

func (hr *HeaderRouter) Route(
	header,
	match string,
	middlewareHandler func(next http.Handler) http.Handler,
) *HeaderRouter {
	header = strings.ToLower(header)

	k := hr.routes[header]
	if k == nil {
		hr.routes[header] = []HeaderRoute{}
	}

	hr.routes[header] = append(
		hr.routes[header],
		HeaderRoute{
			MatchOne:   NewPattern(strings.ToLower(match), hr.matchingType),
			Middleware: middlewareHandler,
		},
	)
	return hr
}

func (hr *HeaderRouter) RouteAny(
	header string,
	match []string,
	middlewareHandler func(next http.Handler) http.Handler,
) *HeaderRouter {
	header = strings.ToLower(header)

	k := hr.routes[header]
	if k == nil {
		hr.routes[header] = []HeaderRoute{}
	}

	patterns := []Pattern{}
	for _, m := range match {
		patterns = append(patterns, NewPattern(m, hr.matchingType))
	}

	hr.routes[header] = append(
		hr.routes[header],
		HeaderRoute{MatchAny: patterns, Middleware: middlewareHandler},
	)

	return hr
}

func (hr *HeaderRouter) RouteDefault(handler func(next http.Handler) http.Handler) *HeaderRouter {
	hr.routes["*"] = []HeaderRoute{{Middleware: handler}}
	return hr
}

func (hr *HeaderRouter) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(wrt http.ResponseWriter, req *http.Request) {
		if len(hr.routes) == 0 {
			// skip if no routes set
			next.ServeHTTP(wrt, req)
		}

		// find first matching header route, and continue
		for header, matchers := range hr.routes {
			headerValue := req.Header.Get(header)
			if headerValue == "" {
				continue
			}

			headerValue = strings.ToLower(headerValue)
			for _, matcher := range matchers {
				if matcher.IsMatch(headerValue) {
					matcher.Middleware(next).ServeHTTP(wrt, req)
					return
				}
			}
		}

		// if no match, check for "*" default route
		matcher, ok := hr.routes["*"]
		if !ok || matcher[0].Middleware == nil {
			next.ServeHTTP(wrt, req)
			return
		}

		matcher[0].Middleware(next).ServeHTTP(wrt, req)
	})
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
	prefix       string
	suffix       string
	wildcard     bool
	value        string
	matchingType MatcherType
}

func NewPattern(value string, matchingType MatcherType) Pattern {
	pat := Pattern{matchingType: matchingType}
	switch matchingType {
	case RouteHeadersClassicMatcher:
		pat.prefix, pat.suffix, pat.wildcard = strings.Cut(value, "*")
	case RouteHeadersContainsMatcher:
		pat.value = value
	case RouteHeadersRegexMatcher:
		pat.value = value
	}
	return pat
}

func (p Pattern) Match(mVal string) bool {
	switch p.matchingType {
	case RouteHeadersClassicMatcher:
		if !p.wildcard {
			return p.prefix == mVal
		}
		return len(mVal) >= len(p.prefix+p.suffix) &&
			strings.HasPrefix(mVal, p.prefix) &&
			strings.HasSuffix(mVal, p.suffix)
	case RouteHeadersContainsMatcher:
		return strings.Contains(mVal, p.value)
	case RouteHeadersRegexMatcher:
		reg := regexp.MustCompile(p.value)
		return reg.MatchString(mVal)
	}
	return false
}
