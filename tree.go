package chi

// Radix tree implementation below is a based on the original work by
// Armon Dadgar in https://github.com/armon/go-radix/blob/master/radix.go
// (MIT licensed). It's been heavily modified for use as a HTTP routing tree.

import (
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
)

type methodTyp int

const (
	mCONNECT methodTyp = 1 << iota
	mDELETE
	mGET
	mHEAD
	mLINK
	mOPTIONS
	mPATCH
	mPOST
	mPUT
	mTRACE
	mUNLINK
	mSTUB

	mALL methodTyp = mCONNECT | mDELETE | mGET | mHEAD | mLINK |
		mOPTIONS | mPATCH | mPOST | mPUT | mTRACE | mUNLINK
)

var methodMap = map[string]methodTyp{
	"CONNECT": mCONNECT,
	"DELETE":  mDELETE,
	"GET":     mGET,
	"HEAD":    mHEAD,
	"LINK":    mLINK,
	"OPTIONS": mOPTIONS,
	"PATCH":   mPATCH,
	"POST":    mPOST,
	"PUT":     mPUT,
	"TRACE":   mTRACE,
	"UNLINK":  mUNLINK,
}

type nodeTyp uint8

const (
	ntStatic   nodeTyp = iota // /home
	ntRegexp                  // /{id:[0-9]+}
	ntParam                   // /{user}
	ntCatchAll                // /api/v1/*
)

type node struct {
	// node type: static, regexp, param, catchAll
	typ nodeTyp

	// first byte of the prefix
	label byte

	// first byte of the child prefix
	tail byte

	// prefix is the common prefix we ignore
	prefix string

	// regexp matcher for regexp nodes
	rex *regexp.Regexp

	// pattern is the routing pattern for handler nodes
	pattern string

	// parameter keys recorded on handler nodes
	paramKeys []string

	// HTTP handler on the leaf node
	handlers methodHandlers

	// subroutes on the leaf node
	subroutes Routes

	// child nodes should be stored in-order for iteration,
	// in groups of the node type.
	children [ntCatchAll + 1]nodes
}

func (n *node) InsertRoute(method methodTyp, pattern string, handler http.Handler) *node {
	var parent *node
	search := pattern

	for {
		// Handle key exhaustion
		if len(search) == 0 {
			// Insert or update the node's leaf handler
			n.setHandler(method, handler, pattern)
			return n
		}

		// We're going to be searching for a wild node next,
		// in this case, we need to get the tail
		var label byte = search[0]
		var segTail byte
		var segEndIdx int
		var segTyp nodeTyp
		var segRexpat string
		if label == '{' || label == '*' {
			segTyp, _, segRexpat, segTail, _, segEndIdx = patNextSegment(search)
		}

		var prefix string
		if segTyp == ntRegexp {
			prefix = segRexpat
		}

		// Look for the edge to attach to
		parent = n
		n = n.getEdge(segTyp, label, segTail, prefix)

		// No edge, create one
		if n == nil {
			child := &node{label: label, tail: segTail, prefix: search}
			hn := parent.addChild(child, search)
			hn.setHandler(method, handler, pattern)

			return hn
		}

		// Found an edge to match the pattern

		if n.typ > ntStatic {
			// We found a param node, trim the param from the search path and continue.
			// This param/wild pattern segment would already be on the tree from a previous
			// call to addChild when creating a new node.
			search = search[segEndIdx:]
			continue
		}

		// Static nodes fall below here.
		// Determine longest prefix of the search key on match.
		commonPrefix := longestPrefix(search, n.prefix)
		if commonPrefix == len(n.prefix) {
			// the common prefix is as long as the current node's prefix we're attempting to insert.
			// keep the search going.
			search = search[commonPrefix:]
			continue
		}

		// Split the node
		child := &node{
			typ:    ntStatic,
			prefix: search[:commonPrefix],
		}
		parent.replaceChild(search[0], segTail, child)

		// Restore the existing node
		n.label = n.prefix[commonPrefix]
		n.prefix = n.prefix[commonPrefix:]
		child.addChild(n, n.prefix)

		// If the new key is a subset, set the method/handler on this node and finish.
		search = search[commonPrefix:]
		if len(search) == 0 {
			child.setHandler(method, handler, pattern)
			return child
		}

		// Create a new edge for the node
		subchild := &node{
			typ:    ntStatic,
			label:  search[0],
			prefix: search,
		}
		hn := child.addChild(subchild, search)
		hn.setHandler(method, handler, pattern)
		return hn
	}
}

// addChild appends the new `child` node to the tree using the `pattern` as the trie key.
// For a URL router like chi's, we split the static, param, regexp and wildcard segments
// into different nodes. In addition, addChild will recursively call itself until every
// pattern segment is added to the url pattern tree as individual nodes, depending on type.
func (n *node) addChild(child *node, prefix string) *node {
	search := prefix

	// handler leaf node added to the tree is the child.
	// this may be overridden later down the flow
	hn := child

	// Parse next segment
	segTyp, _, segRexpat, segTail, segStartIdx, segEndIdx := patNextSegment(search)

	// Add child depending on next up segment
	switch segTyp {

	case ntStatic:
		// Search prefix is all static (that is, has no params in path)
		// noop

	default:
		// Search prefix contains a param, regexp or wildcard

		if segTyp == ntRegexp {
			rex, err := regexp.Compile(segRexpat)
			if err != nil {
				panic(fmt.Sprintf("chi: invalid regexp pattern '%s' in route param", segRexpat))
			}
			child.prefix = segRexpat
			child.rex = rex
		}

		if segStartIdx == 0 {
			// Route starts with a param
			child.typ = segTyp

			if segTyp == ntCatchAll {
				segStartIdx = -1
			} else {
				segStartIdx = segEndIdx
			}
			if segStartIdx < 0 {
				segStartIdx = len(search)
			}
			child.tail = segTail // for params, we set the tail

			if segStartIdx != len(search) {
				// add static edge for the remaining part, split the end.
				// its not possible to have adjacent param nodes, so its certainly
				// going to be a static node next.

				search = search[segStartIdx:] // advance search position

				nn := &node{
					typ:    ntStatic,
					label:  search[0],
					prefix: search,
				}
				hn = child.addChild(nn, search)
			}

		} else if segStartIdx > 0 {
			// Route has some param

			// starts with a static segment
			child.typ = ntStatic
			child.prefix = search[:segStartIdx]
			child.rex = nil

			// add the param edge node
			search = search[segStartIdx:]

			nn := &node{
				typ:   segTyp,
				label: search[0],
				tail:  segTail,
			}
			hn = child.addChild(nn, search)

		}
	}

	n.children[child.typ] = append(n.children[child.typ], child)
	n.children[child.typ].Sort()
	return hn
}

func (n *node) replaceChild(label, tail byte, child *node) {
	for i := 0; i < len(n.children[child.typ]); i++ {
		if n.children[child.typ][i].label == label && n.children[child.typ][i].tail == tail {
			n.children[child.typ][i] = child
			n.children[child.typ][i].label = label
			n.children[child.typ][i].tail = tail
			return
		}
	}
	panic("chi: replacing missing child")
}

func (n *node) getEdge(ntyp nodeTyp, label, tail byte, prefix string) *node {
	nds := n.children[ntyp]
	for i := 0; i < len(nds); i++ {
		if nds[i].label == label && nds[i].tail == tail {
			if ntyp == ntRegexp && nds[i].prefix != prefix {
				continue
			}
			return nds[i]
		}
	}
	return nil
}

func (n *node) setHandler(method methodTyp, handler http.Handler, pattern string) {
	n.pattern = pattern
	n.paramKeys = patParamKeys(pattern)

	// Set the handler for the method type on the node
	if n.handlers == nil {
		n.handlers = make(methodHandlers, 0)
	}
	if method&mSTUB == mSTUB {
		n.handlers[mSTUB] = handler
	} else {
		n.handlers[mSTUB] = nil
	}
	if method&mALL == mALL {
		n.handlers[mALL] = handler
		for _, m := range methodMap {
			n.handlers[m] = handler
		}
	} else {
		n.handlers[method] = handler
	}
}

func (n *node) FindRoute(rctx *Context, path string) methodHandlers {
	// Reset the context routing pattern and params
	rctx.RoutePattern = ""
	rctx.routeParams.keys = rctx.routeParams.keys[:0]
	rctx.routeParams.values = rctx.routeParams.values[:0]

	// Find the routing handlers for the path
	rn := n.findRoute(rctx, path)
	if rn == nil {
		return nil
	}

	// Record the routing params in the request lifecycle
	rctx.URLParams = append(rctx.URLParams, rctx.routeParams)

	// Record the routing pattern in the request lifecycle
	if rn.pattern != "" {
		rctx.RoutePattern = rn.pattern
		rctx.RoutePatterns = append(rctx.RoutePatterns, rctx.RoutePattern)
	}

	return rn.handlers
}

// Recursive edge traversal by checking all nodeTyp groups along the way.
// It's like searching through a multi-dimensional radix trie.
func (n *node) findRoute(rctx *Context, path string) *node {
	nn := n
	search := path

	for t, nds := range nn.children {
		ntyp := nodeTyp(t)
		if len(nds) == 0 {
			continue
		}

		var xn *node
		xsearch := search

		var label byte
		if search != "" {
			label = search[0]
		}

		switch ntyp {
		case ntStatic:
			xn = nds.findEdge(label)
			if xn == nil || !strings.HasPrefix(xsearch, xn.prefix) {
				continue
			}
			xsearch = xsearch[len(xn.prefix):]

		case ntParam, ntRegexp:
			// serially loop through each node grouped by the tail delimiter
			for idx := 0; idx < len(nds); idx++ {
				xn = nds[idx]

				// label for param nodes is the delimiter byte
				p := strings.IndexByte(xsearch, xn.tail)

				if p <= 0 {
					if xn.tail == '/' {
						p = len(xsearch)
					} else {
						continue
					}
				}

				if ntyp == ntRegexp && xn.rex != nil {
					if xn.rex.Match([]byte(xsearch[:p])) == false {
						continue
					}
				}

				rctx.routeParams.values = append(rctx.routeParams.values, xsearch[:p])
				xsearch = xsearch[p:]
				break
			}

		default:
			// catch-all nodes
			rctx.routeParams.values = append(rctx.routeParams.values, search)
			xn = nds[0]
			xsearch = ""
		}

		if xn == nil {
			continue
		}

		// did we find it yet?
		if len(xsearch) == 0 {
			if xn.isLeaf() {
				rctx.routeParams.keys = append(rctx.routeParams.keys, xn.paramKeys...)
				return xn
			}
		}

		// recursively find the next node..
		fin := xn.findRoute(rctx, xsearch)
		if fin != nil {
			return fin
		}

		// Did not find final handler, let's remove the param here if it was set
		if xn.typ > ntStatic {
			if len(rctx.routeParams.values) > 0 {
				rctx.routeParams.values = rctx.routeParams.values[:len(rctx.routeParams.values)-1]
			}
		}

	}

	return nil
}

func (n *node) findEdge(ntyp nodeTyp, label byte) *node {
	nds := n.children[ntyp]
	num := len(nds)
	idx := 0

	switch ntyp {
	case ntStatic, ntParam, ntRegexp:
		i, j := 0, num-1
		for i <= j {
			idx = i + (j-i)/2
			if label > nds[idx].label {
				i = idx + 1
			} else if label < nds[idx].label {
				j = idx - 1
			} else {
				i = num // breaks cond
			}
		}
		if nds[idx].label != label {
			return nil
		}
		return nds[idx]

	default: // catch all
		return nds[idx]
	}
}

func (n *node) isEmpty() bool {
	for _, nds := range n.children {
		if len(nds) > 0 {
			return false
		}
	}
	return true
}

func (n *node) isLeaf() bool {
	return n.handlers != nil
}

func (n *node) matchPattern(pattern string) bool {
	nn := n
	for _, nds := range nn.children {
		if len(nds) == 0 {
			continue
		}

		n = nn.findEdge(nds[0].typ, pattern[0])
		if n == nil {
			continue
		}

		var idx int
		var xpattern string

		switch n.typ {
		case ntStatic:
			idx = longestPrefix(pattern, n.prefix)
			if idx < len(n.prefix) {
				continue
			}

		case ntParam, ntRegexp:
			idx = strings.IndexByte(pattern, '}') + 1

		case ntCatchAll:
			idx = longestPrefix(pattern, "*")

		default:
			panic("chi: unknown node type")
		}

		xpattern = pattern[idx:]
		if len(xpattern) == 0 {
			return true
		}

		return n.matchPattern(xpattern)
	}
	return false
}

func (n *node) routes() []Route {
	rts := []Route{}

	n.walkRoutes(n.prefix, n, func(pattern string, handlers methodHandlers, subroutes Routes) bool {
		if handlers[mSTUB] != nil && subroutes == nil {
			return false
		}

		if subroutes != nil && len(pattern) > 2 {
			pattern = pattern[:len(pattern)-2]
		}

		var hs = make(map[string]http.Handler, 0)
		if handlers[mALL] != nil {
			hs["*"] = handlers[mALL]
		}
		for mt, h := range handlers {
			if h == nil {
				continue
			}
			m := methodTypString(mt)
			if m == "" {
				continue
			}
			hs[m] = h
		}

		rt := Route{pattern, hs, subroutes}
		rts = append(rts, rt)
		return false
	})

	return rts
}

func (n *node) walkRoutes(pattern string, nd *node, fn walkFn) bool {
	pattern = nd.pattern

	// Visit the leaf values if any
	if (nd.handlers != nil || nd.subroutes != nil) && fn(pattern, nd.handlers, nd.subroutes) {
		return true
	}

	// Recurse on the children
	for _, nds := range nd.children {
		for _, nd := range nds {
			if n.walkRoutes(pattern, nd, fn) {
				return true
			}
		}
	}
	return false
}

// patNextSegment returns the next segment details from a pattern:
// node type, param key, regexp string, param tail byte, param starting index, param ending index
func patNextSegment(pattern string) (nodeTyp, string, string, byte, int, int) {
	ps := strings.Index(pattern, "{")
	ws := strings.Index(pattern, "*")

	if ps < 0 && ws < 0 {
		return ntStatic, "", "", 0, 0, len(pattern) // we return the entire thing
	}

	// Sanity check
	if ps >= 0 && ws >= 0 && ws < ps {
		panic("chi: wildcard '*' must be the last pattern in a route, otherwise use a '{param}'")
	}

	var tail byte = '/' // Default endpoint tail to / byte

	if ps >= 0 {
		// Param/Regexp pattern is next
		nt := ntParam
		pe := strings.Index(pattern, "}")
		if pe < 0 {
			panic("chi: route param closing delimiter '}' is missing")
		}

		key := pattern[ps+1 : pe]
		pe += 1 // set end to next position

		if pe < len(pattern) {
			tail = pattern[pe]
		}

		var rexpat string
		if idx := strings.Index(key, ":"); idx >= 0 {
			nt = ntRegexp
			rexpat = key[idx+1:]
			key = key[:idx]
		}

		return nt, key, rexpat, tail, ps, pe
	} else {
		// Wildcard pattern is next

		// TODO: should we panic if there is stuff after the * ???

		return ntCatchAll, "*", "", 0, ws, len(pattern)
	}
}

func patParamKeys(pattern string) []string {
	pat := pattern
	paramKeys := []string{}
	for {
		ptyp, paramKey, _, _, _, e := patNextSegment(pat)
		if ptyp == ntStatic {
			return paramKeys
		}
		for i := 0; i < len(paramKeys); i++ {
			if paramKeys[i] == paramKey {
				panic(fmt.Sprintf("chi: routing pattern '%s' contains duplicate param key, '%s'", pattern, paramKey))
			}
		}
		paramKeys = append(paramKeys, paramKey)
		pat = pat[e:]
	}
	return paramKeys
}

// longestPrefix finds the length of the shared prefix
// of two strings
func longestPrefix(k1, k2 string) int {
	max := len(k1)
	if l := len(k2); l < max {
		max = l
	}
	var i int
	for i = 0; i < max; i++ {
		if k1[i] != k2[i] {
			break
		}
	}
	return i
}

func methodTypString(method methodTyp) string {
	for s, t := range methodMap {
		if method == t {
			return s
		}
	}
	return ""
}

type walkFn func(pattern string, handlers methodHandlers, subroutes Routes) bool

// methodHandlers is a mapping of http method constants to handlers
// for a given route.
type methodHandlers map[methodTyp]http.Handler

type nodes []*node

// Sort the list of nodes by label
func (ns nodes) Sort()              { sort.Sort(ns); ns.tailSort() }
func (ns nodes) Len() int           { return len(ns) }
func (ns nodes) Swap(i, j int)      { ns[i], ns[j] = ns[j], ns[i] }
func (ns nodes) Less(i, j int) bool { return ns[i].label < ns[j].label }

// tailSort pushes nodes with '/' as the tail to the end of the list for param nodes.
// The list order determines the traversal order.
func (ns nodes) tailSort() {
	for i := len(ns) - 1; i >= 0; i-- {
		if ns[i].typ > ntStatic && ns[i].tail == '/' {
			ns.Swap(i, len(ns)-1)
			return
		}
	}
}

func (ns nodes) findEdge(label byte) *node {
	num := len(ns)
	idx := 0
	i, j := 0, num-1
	for i <= j {
		idx = i + (j-i)/2
		if label > ns[idx].label {
			i = idx + 1
		} else if label < ns[idx].label {
			j = idx - 1
		} else {
			i = num // breaks cond
		}
	}
	if ns[idx].label != label {
		return nil
	}
	return ns[idx]
}

type Route struct {
	Pattern   string
	Handlers  map[string]http.Handler
	SubRoutes Routes
}
