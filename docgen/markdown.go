package docgen

import (
	"bytes"
	"errors"
	"fmt"

	"github.com/pressly/chi"
)

type MarkdownDoc struct {
	Router chi.Router
	Doc    Doc
	Routes map[string]DocRouter // Pattern : DocRouter

	buf *bytes.Buffer
}

func MarkdownRoutesDoc(r chi.Router) string {
	md := &MarkdownDoc{Router: r}
	if err := md.Generate(); err != nil {
		return fmt.Sprintf("ERROR: %s\n", err.Error())
	}
	return md.String()
}

func (md *MarkdownDoc) String() string {
	return md.buf.String()
}

func (md *MarkdownDoc) Generate() error {
	if md.Router == nil {
		return errors.New("docgen: router is nil")
	}

	doc, err := BuildDoc(md.Router)
	if err != nil {
		return err
	}

	md.Doc = doc
	md.buf = &bytes.Buffer{}
	md.Routes = make(map[string]DocRouter)

	md.WriteIntro()
	md.WriteRoutes()

	return nil
}

func (md *MarkdownDoc) WriteIntro() {
	// TODO: get real name
	pkgName := "github.com/pressly/chi/_examples/rest"
	md.buf.WriteString(fmt.Sprintf("# %s\n\n", pkgName))

	intro := "Routing docs generated with chi/docgen. Run xx to regenerate the docs."
	md.buf.WriteString(fmt.Sprintf("%s\n\n", intro))
}

func (md *MarkdownDoc) WriteRoutes() {
	md.buf.WriteString(fmt.Sprintf("## Routes\n\n"))

	var buildRoutesMap func(parentPattern string, ar, nr, dr *DocRouter)
	buildRoutesMap = func(parentPattern string, ar, nr, dr *DocRouter) {

		nr.Middlewares = append(nr.Middlewares, dr.Middlewares...)

		for pat, rt := range dr.Routes {
			pattern := parentPattern + pat

			nr.Routes = DocRoutes{}

			if rt.Router != nil {
				nnr := &DocRouter{}
				nr.Routes[pat] = DocRoute{
					Pattern:  pat,
					Handlers: rt.Handlers,
					Router:   nnr,
				}
				buildRoutesMap(pattern, ar, nnr, rt.Router)

			} else if len(rt.Handlers) > 0 {
				nr.Routes[pat] = DocRoute{
					Pattern:  pat,
					Handlers: rt.Handlers,
					Router:   nil,
				}

				// TODO: remove trailing slash if handler is "/"
				md.Routes[pattern] = copyDocRouter(*ar)

			} else {
				panic("not possible")
			}
		}

	}

	// Build a route tree that consists of the full route pattern
	// and the part of the tree for just that specific route, stored
	// in routes map on the markdown struct. This is the structure we
	// are going to render to markdown.
	dr := md.Doc.Router
	ar := DocRouter{}
	buildRoutesMap("", &ar, &ar, &dr)

	// Generate the markdown to render the above structure
	var printRouter func(depth int, dr DocRouter)
	printRouter = func(depth int, dr DocRouter) {

		tabs := ""
		for i := 0; i < depth; i++ {
			tabs += "\t"
		}

		// Middlewares
		for _, mw := range dr.Middlewares {
			md.buf.WriteString(fmt.Sprintf("%s- [%s]()\n", tabs, mw.Func))
		}

		// Routes
		for _, rt := range dr.Routes {
			md.buf.WriteString(fmt.Sprintf("%s- **%s**\n", tabs, rt.Pattern))

			if rt.Router != nil {
				printRouter(depth+1, *rt.Router)
			} else {
				for meth, dh := range rt.Handlers {
					md.buf.WriteString(fmt.Sprintf("%s\t- _%s_\n", tabs, meth))

					// Handler middlewares
					for _, mw := range dh.Middlewares {
						md.buf.WriteString(fmt.Sprintf("%s\t\t- [%s]()\n", tabs, mw.Func))
					}

					// Handler endpoint
					md.buf.WriteString(fmt.Sprintf("%s\t\t- [%s]()\n", tabs, dh.Func))
				}
			}
		}
	}

	for pat, dr := range md.Routes {
		md.buf.WriteString(fmt.Sprintf("<details>\n"))
		md.buf.WriteString(fmt.Sprintf("<summary>%s</summary>\n", pat))
		printRouter(0, dr)
		md.buf.WriteString(fmt.Sprintf("</details>\n"))
	}
}
