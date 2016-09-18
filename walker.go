package chi

import (
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/pressly/chi"
)

type (
	WalkFn func(method string, route string, handler Handler, mws Middlewares) error

	Handler struct {
		http.Handler
	}

	Middleware struct {
		Middleware func(http.Handler) http.Handler
	}

	Middlewares []Middleware
)

func Walk(r chi.Routes, fn WalkFn) error {
	return walk(r, fn, "", []Middleware{})
}

func walk(r chi.Routes, fn WalkFn, parentRoute string, parentMw []Middleware) error {
	for _, route := range r.Routes() {
		mws := append([]Middleware{}, parentMw...)
		for _, mw := range r.Middlewares() {
			mws = append(mws, Middleware{mw})
		}

		if route.SubRoutes != nil {
			if err := walk(route.SubRoutes, fn, parentRoute+route.Pattern, mws); err != nil {
				return err
			}
			for method, handler := range route.Handlers {
				log.Printf("%v %v: %+v", method, route.Pattern, handler)
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

			h := Handler{handler}
			if chain, ok := handler.(*chi.ChainHandler); ok {
				for _, mw := range chain.Middlewares {
					mws = append(mws, Middleware{mw})
				}
				h.Handler = chain.Endpoint
			}

			// TODO: Hrm.. Most of the time, the route.Pattern ends with an
			// extra '/', even though it doesn't match the actual route, why?
			fullRoute := strings.TrimRight(parentRoute+route.Pattern, "/")
			if fullRoute == "" {
				fullRoute = "/"
			}
			if err := fn(method, fullRoute, h, mws); err != nil {
				return err
			}
		}
	}

	return nil
}

func (h Handler) String() string {
	info := buildFuncInfo(h.Handler)
	return fmt.Sprintf("%v.%v", info.Pkg, info.Func)
}

func (h Handler) FuncInfo() FuncInfo {
	return buildFuncInfo(h.Handler)
}

func (mw Middleware) String() string {
	info := buildFuncInfo(mw.Middleware)
	return fmt.Sprintf("%v.%v", info.Pkg, info.Func)
}

func (mws Middlewares) String() string {
	str := ""
	for _, mw := range mws {
		str += mw.String() + ", "
	}
	return str
}

func (mw Middleware) FuncInfo() FuncInfo {
	return buildFuncInfo(mw.Middleware)
}
