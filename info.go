package chi

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
)

type FuncInfo struct {
	Pkg          string `json:"pkg"`
	Func         string `json:"func"`
	Comment      string `json:"comment"`
	File         string `json:"file,omitempty"`
	Line         int    `json:"line,omitempty"`
	Anonymous    bool   `json:"anonymous,omitempty"`
	Unresolvable bool   `json:"unresolvable,omitempty"`
}

func GetFuncInfo(i interface{}) FuncInfo {
	fi := FuncInfo{}
	frame := getCallerFrame(i)
	goPathSrc := filepath.Join(os.Getenv("GOPATH"), "src")

	if frame == nil {
		fi.Unresolvable = true
		return fi
	}

	pkgName := getPkgName(frame.File)
	if pkgName == "chi" {
		fi.Unresolvable = true
	}
	funcPath := frame.Func.Name()

	idx := strings.Index(funcPath, "/"+pkgName)
	if idx > 0 {
		fi.Pkg = funcPath[:idx+1+len(pkgName)]
		fi.Func = funcPath[idx+2+len(pkgName):]
	} else {
		fi.Func = funcPath
	}

	if strings.Index(fi.Func, ".func") > 0 {
		fi.Anonymous = true
	}

	fi.File = frame.File
	fi.Line = frame.Line
	if filepath.HasPrefix(fi.File, goPathSrc) {
		fi.File = fi.File[len(goPathSrc)+1:]
	}

	// Check if file info is unresolvable
	if strings.Index(funcPath, pkgName) < 0 {
		fi.Unresolvable = true
	}

	if !fi.Unresolvable {
		fi.Comment = getFuncComment(frame.File, frame.Line)
	}

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
