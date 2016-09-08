package docgen

type Doc struct {
	Router DocRouter `json:"router"`
}

type DocRouter struct {
	Middlewares []DocMiddleware `json:"middlewares"`
	Routes      DocRoutes       `json:"routes"`
}

type DocMiddleware struct {
	FuncInfo
}

type DocRoute struct {
	Pattern  string      `json:"-"`
	Handlers DocHandlers `json:"handlers,omitempty"`
	Router   *DocRouter  `json:"router,omitempty"`
}

type DocRoutes map[string]DocRoute // Pattern : DocRoute

type DocHandler struct {
	Middlewares []DocMiddleware `json:"middlewares"`
	Method      string          `json:"method"`
	FuncInfo
}

type DocHandlers map[string]DocHandler // Method : DocHandler

type FuncInfo struct {
	Pkg          string `json:"pkg"`
	Func         string `json:"func"`
	Comment      string `json:"comment"`
	File         string `json:"file,omitempty"`
	Line         int    `json:"line,omitempty"`
	Anonymous    bool   `json:"anonymous,omitempty"`
	Unresolvable bool   `json:"unresolvable,omitempty"`
}
