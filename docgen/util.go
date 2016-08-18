package docgen

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
)

// TODO: track unresolvable functions such as /folders/in
// where the pkg and func do not match up..

// TODO: /webooks/* is returning (*Mux).Mount.func1 --
// the subhandler ... which in fact, we do not want.
// So perhaps, we skip chi code as well..

func getFuncInfo(i interface{}) FuncInfo {
	fi := FuncInfo{}
	frame := getCallerFrame(i)
	goPathSrc := filepath.Join(os.Getenv("GOPATH"), "src")

	fi.Pkg = getPkgName(frame.File)

	// TODO: anonymous...?

	fi.Func = frame.Func.Name()
	idx := strings.Index(fi.Func, "/"+fi.Pkg)
	if idx > 0 {
		fi.Func = fi.Func[idx+len(fi.Pkg)+2:]
	}

	fi.File = frame.File
	fi.Line = frame.Line
	if filepath.HasPrefix(fi.File, goPathSrc) {
		fi.File = fi.File[len(goPathSrc)+1:]
	}

	fi.Comment = getFuncComment(frame.File, frame.Line)

	return fi
}

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
