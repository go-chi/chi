package render

import (
	"encoding/json"
	"encoding/xml"
	"errors"
	"io"
	"io/ioutil"
	"net/http"
)

// Decode is a package-level variable set to our default Decoder. We do this
// because it allows you to set render.Decode to another function with the
// same function signature, while also utilizing the render.Decoder() function
// itself. Effectively, allowing you to easily add your own logic to the package
// defaults. For example, maybe you want to impose a limit on the number of
// bytes allowed to be read from the request body.
var Decode = DefaultDecoder

func DefaultDecoder(r *http.Request, v interface{}) error {
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
