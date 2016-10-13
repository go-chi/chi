package render

// TODO
// Build takes the source object (usually some data model object), and
// maps it to a response payload object. For example *Article to *ArticleResponse
//
// One idea is to use struct tags on the payload object to map the object etc
//
// type ArticleResponse struct {
//   *Article `payload:""`
// }
//
// is there a method on this to call..? hmm, like Present() ..
func Build(src, dst interface{}) interface{} {
	return src
}

// TODO: perhaps we have some kind of Payload() or ResponsePayload()
// middleware that will set the type of response, etc. and triggers
// this Build() stuff automatically.

// TODO: is there overlap here with Present() ?
// if so, perhaps we can converge the ideas, or are they different things?
