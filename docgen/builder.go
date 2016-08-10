package docgen

import (
	"fmt"

	"github.com/pressly/chi"
)

func BuildDoc(r chi.Router) (Doc, error) {
	d := Doc{}
	d.Router = buildDocRouter(r)
	return d, nil
}

func buildDocRouter(r chi.Router) DocRouter {
	dr := DocRouter{Middlewares: []DocMiddleware{}}
	drts := DocRoutes{}
	dr.Routes = drts

	for _, mw := range r.Middlewares() {
		dmw := DocMiddleware{
			Name: fmt.Sprintf("%v", mw),
		}
		dr.Middlewares = append(dr.Middlewares, dmw)
	}

	for _, rt := range r.Routes() {
		drt := DocRoute{Pattern: rt.Pattern, Handlers: DocHandlers{}}

		if rt.SubRouter != nil {
			subDrts := buildDocRouter(rt.SubRouter)
			drt.Router = &subDrts

		} else {
			hall := rt.Handlers["*"]
			for method, h := range rt.Handlers {
				if method != "*" && hall != nil && fmt.Sprintf("%v", hall) == fmt.Sprintf("%v", h) {
					continue
				}
				dh := DocHandler{
					Method:   method,
					Endpoint: fmt.Sprintf("%v", h),
				}
				drt.Handlers[method] = dh
			}
		}

		drts[rt.Pattern] = drt
	}

	return dr
}

func PrintRoutes(prefix string, parentPattern string, r chi.Router) {
	rts := r.Routes()
	for _, rt := range rts {
		if rt.SubRouter == nil {
			fmt.Println(prefix, parentPattern+rt.Pattern)
		} else {
			pat := rt.Pattern
			PrintRoutes("=="+prefix, parentPattern+pat, rt.SubRouter)
		}
	}
}
