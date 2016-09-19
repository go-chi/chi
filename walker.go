package chi

import (
	"fmt"
	"net/http"
	"strings"
)

type WalkFn func(method string, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error

func Walk(r Routes, fn WalkFn) error {
	return walk(r, fn, "")
}

func walk(r Routes, fn WalkFn, parentRoute string, parentMw ...func(http.Handler) http.Handler) error {
	for _, route := range r.Routes() {
		mws := make([]func(http.Handler) http.Handler, len(parentMw))
		copy(mws, parentMw)
		mws = append(mws, r.Middlewares()...)

		if route.SubRoutes != nil {
			if err := walk(route.SubRoutes, fn, parentRoute+route.Pattern, mws...); err != nil {
				return err
			}
			continue
		}

		hall := route.Handlers["*"]
		for method, handler := range route.Handlers {
			// TODO: Hrm.. this shouldn't be necessary.
			// Imho, r.Routes() shouldn't give us '*' method plus all the methods.
			// And, we shouldn't call fn() with '*' method at all.
			if method != "*" && hall != nil && fmt.Sprintf("%v", hall) == fmt.Sprintf("%v", handler) {
				continue
			}

			// TODO: Hrm.. Most of the time, the route.Pattern ends with an
			// extra '/', even though it doesn't match the actual route, why?
			fullRoute := strings.TrimRight(parentRoute+route.Pattern, "/")
			if fullRoute == "" {
				fullRoute = "/"
			}

			if chain, ok := handler.(*ChainHandler); ok {
				if err := fn(method, fullRoute, chain.Endpoint, append(mws, chain.Middlewares...)...); err != nil {
					return err
				}
			} else {
				if err := fn(method, fullRoute, handler, mws...); err != nil {
					return err
				}
			}
		}
	}

	return nil
}
