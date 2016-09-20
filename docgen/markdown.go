package docgen

import (
	"bytes"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/pressly/chi"
)

type MarkdownDoc struct {
	Opts   MarkdownOpts
	Router chi.Router
	Doc    Doc
	Routes map[string]DocRouter // Pattern : DocRouter

	buf *bytes.Buffer
}

type MarkdownOpts struct {
	ProjectPath string
	Intro       string
}

func MarkdownRoutesDoc(r chi.Router, opts MarkdownOpts) string {
	md := &MarkdownDoc{Router: r, Opts: opts}
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
	pkgName := md.Opts.ProjectPath
	md.buf.WriteString(fmt.Sprintf("# %s\n\n", pkgName))

	intro := md.Opts.Intro
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
			md.buf.WriteString(fmt.Sprintf("%s- [%s](%s)\n", tabs, mw.Func, md.githubSourceURL(mw.File, mw.Line)))
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
						md.buf.WriteString(fmt.Sprintf("%s\t\t- [%s](%s)\n", tabs, mw.Func, md.githubSourceURL(mw.File, mw.Line)))
					}

					// Handler endpoint
					md.buf.WriteString(fmt.Sprintf("%s\t\t- [%s](%s)\n", tabs, dh.Func, md.githubSourceURL(dh.File, dh.Line)))
				}
			}
		}
	}

	routePaths := []string{}
	for pat, _ := range md.Routes {
		routePaths = append(routePaths, pat)
	}
	sort.Strings(routePaths)

	for _, pat := range routePaths {
		dr := md.Routes[pat]
		md.buf.WriteString(fmt.Sprintf("<details>\n"))
		md.buf.WriteString(fmt.Sprintf("<summary>%s</summary>\n", pat))
		md.buf.WriteString(fmt.Sprintf("\n"))
		printRouter(0, dr)
		md.buf.WriteString(fmt.Sprintf("\n"))
		md.buf.WriteString(fmt.Sprintf("</details>\n"))
	}

	md.buf.WriteString(fmt.Sprintf("\n"))
	md.buf.WriteString(fmt.Sprintf("Total # of routes: %d\n", len(md.Routes)))

	// TODO: total number of handlers..
}

func (md *MarkdownDoc) githubSourceURL(file string, line int) string {
	// Currently, we only link to source for github projects
	if strings.Index(file, "github.com/") != 0 {
		return ""
	}
	if md.Opts.ProjectPath == "" {
		return ""
	}
	if idx := strings.Index(file, md.Opts.ProjectPath); idx >= 0 {
		// relative
		pos := idx + len(md.Opts.ProjectPath)
		return fmt.Sprintf("%s#L%d", file[pos:], line)
	} else {
		// absolute
		return fmt.Sprintf("https://%s#L%d", file, line)
	}
}
