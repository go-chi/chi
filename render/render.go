package render

import (
	"net/http"
	"reflect"
)

type Renderer interface {
	Render(w http.ResponseWriter, r *http.Request) error
}

type Binder interface {
	Bind(r *http.Request) error
}

func Bind(r *http.Request, v Binder) error {
	if err := Decode(r, v); err != nil {
		return err
	}
	return binder(r, v)
}

func Render(w http.ResponseWriter, r *http.Request, v Renderer) error {
	if err := renderer(w, r, v); err != nil {
		return err
	}
	Respond(w, r, v)
	return nil
}

func RenderList(w http.ResponseWriter, r *http.Request, l []Renderer) error {
	for _, v := range l {
		if err := renderer(w, r, v); err != nil {
			return err
		}
	}
	Respond(w, r, l)
	return nil
}

// Executed top-down
func renderer(w http.ResponseWriter, r *http.Request, v Renderer) error {
	rv := reflect.ValueOf(v)
	if rv.Kind() == reflect.Ptr {
		rv = rv.Elem()
	}

	// We call it top-down.
	if err := v.Render(w, r); err != nil {
		return err
	}

	// We're done if the Renderer isn't a struct object
	if rv.Kind() != reflect.Struct {
		return nil
	}

	// For structs, we call Render on each field that implements Renderer
	for i := 0; i < rv.NumField(); i++ {
		f := rv.Field(i)
		if f.Type().Implements(rendererType) {

			if f.IsNil() {
				continue
			}

			fv := f.Interface().(Renderer)
			if err := renderer(w, r, fv); err != nil {
				return err
			}

		}
	}

	return nil
}

// Executed bottom-up
func binder(r *http.Request, v Binder) error {
	rv := reflect.ValueOf(v)
	if rv.Kind() == reflect.Ptr {
		rv = rv.Elem()
	}

	// Call Binder on non-struct types right away
	if rv.Kind() != reflect.Struct {
		return v.Bind(r)
	}

	// For structs, we call Bind on each field that implements Binder
	for i := 0; i < rv.NumField(); i++ {
		f := rv.Field(i)
		if f.Type().Implements(binderType) {

			if f.IsNil() {
				continue
			}

			fv := f.Interface().(Binder)
			if err := binder(r, fv); err != nil {
				return err
			}
		}
	}

	// We call it bottom-up
	if err := v.Bind(r); err != nil {
		return err
	}

	return nil
}

var (
	rendererType = reflect.TypeOf(new(Renderer)).Elem()
	binderType   = reflect.TypeOf(new(Binder)).Elem()
)

// contextKey is a value for use with context.WithValue. It's used as
// a pointer so it fits in an interface{} without allocation. This technique
// for defining context keys was copied from Go 1.7's new use of context in net/http.
type contextKey struct {
	name string
}

func (k *contextKey) String() string {
	return "chi render context value " + k.name
}
