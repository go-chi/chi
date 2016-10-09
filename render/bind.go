package render

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"io/ioutil"
	"net/http"
	"reflect"
)

var (
	RequestBodyCtxKey = &contextKey{"RequestBody"}

	Decode = DecodeAny
)

func DecodeAny(r *http.Request, v interface{}) error {
	var err error

	switch GetRequestContentType(r) {
	case ContentTypeJSON:
		err = DecodeJSON(r.Body, v)
	case ContentTypeXML:
		err = DecodeXML(r.Body, v)
	// case ContentTypeForm: // TODO
	default:
		err = errors.New("render: unable to automatically decode the request content type")
	}

	return err
}

func DecodeJSON(r io.Reader, v interface{}) error {
	defer io.Copy(ioutil.Discard, r)
	return json.NewDecoder(r).Decode(v)
}

func DecodeXML(r io.Reader, v interface{}) error {
	defer io.Copy(ioutil.Discard, r)
	return xml.NewDecoder(r).Decode(v)
}

func RequestBody(ctx context.Context) interface{} {
	v := ctx.Value(RequestBodyCtxKey)
	return v
}

func Bind(val interface{}) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {

			t := reflect.TypeOf(val)
			if t.Kind() == reflect.Ptr {
				t = t.Elem()
			}
			if t.Kind() != reflect.Struct {
				panic("render: bind only accepts a struct value or struct object")
			}

			v := reflect.New(t)
			structInit(t, v.Elem())
			reqBody := v.Interface()

			err := Decode(r, &reqBody)
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				Respond(w, r, err.Error()) // TODO: should we have a RequestBodyErrCtxKey ?
				// that reports the error during a decode, etc.?
				return
			}

			ctx := context.WithValue(r.Context(), RequestBodyCtxKey, reqBody)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func structInit(t reflect.Type, v reflect.Value) {
	for i := 0; i < v.NumField(); i++ {
		f := v.Field(i)
		ft := t.Field(i)
		switch ft.Type.Kind() {
		case reflect.Map:
			f.Set(reflect.MakeMap(ft.Type))
		case reflect.Slice:
			f.Set(reflect.MakeSlice(ft.Type, 0, 0))
		case reflect.Chan:
			f.Set(reflect.MakeChan(ft.Type, 0))
		case reflect.Struct:
			structInit(ft.Type, f)
		case reflect.Ptr:
			fv := reflect.New(ft.Type.Elem())
			structInit(ft.Type.Elem(), fv.Elem())
			f.Set(fv)
		default:
		}
	}
}
