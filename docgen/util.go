package docgen

import (
	"reflect"
	"runtime"
)

func getFuncName(i interface{}) string {
	return runtime.FuncForPC(reflect.ValueOf(i).Pointer()).Name()
}

func getFuncFileLine(i interface{}) (file string, line int) {
	pc := reflect.ValueOf(i).Pointer()
	fn := runtime.FuncForPC(pc)

	if fn == nil {
		return "", 0
	}
	return fn.FileLine(pc)
}
