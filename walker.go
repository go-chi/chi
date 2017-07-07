package chi

import "net/http"

// WalkFunc is the type of the function called for each method and route visited by Walk.
type WalkFunc func(method string, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error

// Walk walks any router tree that implements Routes interface.
func Walk(r Routes, walkFn WalkFunc) error {
	return walk(r, walkFn, "")
}

func walk(r Routes, walkFn WalkFunc, parentRoute string, parentMw ...func(http.Handler) http.Handler) error {
	for _, route := range r.Routes() {
		mws := make([]func(http.Handler) http.Handler, len(parentMw))
		copy(mws, parentMw)
		mws = append(mws, r.Middlewares()...)

		if route.SubRoutes != nil {
			if err := walk(route.SubRoutes, walkFn, parentRoute+route.Pattern, mws...); err != nil {
				return err
			}
			continue
		}

		for method, handler := range route.Handlers {
			if method == "*" {
				// Ignore a "catchAll" method, since we pass down all the specific methods for each route.
				continue
			}

			fullRoute := parentRoute + route.Pattern

			if chain, ok := handler.(*ChainHandler); ok {
				if err := walkFn(method, fullRoute, chain.Endpoint, append(mws, chain.Middlewares...)...); err != nil {
					return err
				}
			} else {
				if err := walkFn(method, fullRoute, handler, mws...); err != nil {
					return err
				}
			}
		}
	}

	return nil
}
