package docgen

import (
	"go/parser"
	"go/token"
	"reflect"
	"runtime"
)

func getCallerFrame(i interface{}) *runtime.Frame {
	pc := reflect.ValueOf(i).Pointer()
	frames := runtime.CallersFrames([]uintptr{pc})
	if frames == nil {
		return nil
	}
	frame, _ := frames.Next()
	if frame.Entry == 0 {
		return nil
	}
	return &frame
}

func getPkgName(file string) string {
	fset := token.NewFileSet()
	astFile, err := parser.ParseFile(fset, file, nil, parser.PackageClauseOnly)
	if err != nil {
		return ""
	}
	if astFile.Name == nil {
		return ""
	}
	return astFile.Name.Name
}

func getFuncComment(file string, line int) string {
	fset := token.NewFileSet()

	astFile, err := parser.ParseFile(fset, file, nil, parser.ParseComments)
	if err != nil {
		return ""
	}

	if len(astFile.Comments) == 0 {
		return ""
	}

	for _, cmt := range astFile.Comments {
		if fset.Position(cmt.End()).Line+1 == line {
			return cmt.Text()
		}
	}

	return ""
}

func copyDocRouter(dr DocRouter) DocRouter {
	var cloneRouter func(dr DocRouter) DocRouter
	var cloneRoutes func(drt DocRoutes) DocRoutes

	cloneRoutes = func(drts DocRoutes) DocRoutes {
		rts := DocRoutes{}

		for pat, drt := range drts {
			rt := DocRoute{Pattern: drt.Pattern}
			if len(drt.Handlers) > 0 {
				rt.Handlers = DocHandlers{}
				for meth, dh := range drt.Handlers {
					rt.Handlers[meth] = dh
				}
			}
			if drt.Router != nil {
				rr := cloneRouter(*drt.Router)
				rt.Router = &rr
			}
			rts[pat] = rt
		}

		return rts
	}

	cloneRouter = func(dr DocRouter) DocRouter {
		cr := DocRouter{}
		cr.Middlewares = make([]DocMiddleware, len(dr.Middlewares))
		copy(cr.Middlewares, dr.Middlewares)
		cr.Routes = cloneRoutes(dr.Routes)
		return cr
	}

	return cloneRouter(dr)
}
