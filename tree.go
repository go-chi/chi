package chi

// Radix tree implementation is a based on the work by Armon Dadgar
// in https://github.com/armon/go-radix/blob/master/radix.go
// (MIT licensed)

// TODO: case insensitive ..

// TODO: trailing slash stuff...? perhaps in the Mux{} ..?

import (
	"log"
	"sort"
	"strings"
)

type nodeTyp uint8

const (
	ntStatic   nodeTyp = iota // /home
	ntRegexp                  // /:id([0-9]+)
	ntParam                   // /:user
	ntCatchAll                // /api/v1/*
)

// WalkFn is used when walking the tree. Takes a
// key and value, returning if iteration should
// be terminated.
// type WalkFn func(s string, v interface{}) bool
// TODO: do we want to have method here..?
type WalkFn func(path string, handler Handler) bool

// edge is used to represent an edge node
type edge struct {
	label byte
	node  *node
}

type node struct {
	typ nodeTyp

	// prefix is the common prefix we ignore
	prefix string

	// HTTP handler on the leaf node
	handler Handler

	// Edges should be stored in-order for iteration.
	// We avoid a fully materialized slice to save memory,
	// since in most cases we expect to be sparse
	edges edges

	// TODO: optimization, do we keep track of the number of wildEdges?
	// nWildEdges int
}

func (n *node) isLeaf() bool {
	return n.handler != nil
}

func (n *node) addEdge(e edge) {
	search := e.node.prefix

	// Split the node on a wild type
	p := strings.IndexAny(search, ":*")

	ntyp := ntStatic
	if p >= 0 {
		switch search[p] {
		case ':':
			ntyp = ntParam
		case '*':
			ntyp = ntCatchAll
		}
	}

	// TODO: ...
	// for CatchAll... set the node prefix to just * ..

	// TODO: on find.. and catchall, set param to *

	if p == 0 {
		// split the end prefix of the current node

		handler := e.node.handler
		e.node.typ = ntyp

		if ntyp == ntCatchAll {
			// this would be the node is "*fadfasfd"
			// we can just set it to * and be done with it..
			// no adding any other nodes..
			// hmm.. this wouldn't be an add tho.. it would be
			// a replace if something exists.....
			p = -1
			e.node.prefix = "**"
			goto woot
		} else {
			p = strings.IndexByte(search, '/')
		}
		if p < 0 {
			p = len(search)
		}
		e.node.prefix = search[:p]

		if len(search) != p {
			// add trailing child node.. split the end
			search = search[p:]
			e2 := edge{
				label: search[0], // this will always start with /
				node: &node{
					typ:     ntStatic,
					prefix:  search,
					handler: handler,
				},
			}
			e.node.addEdge(e2)
		}

	} else if p > 0 {
		// split the beginning prefix of the current node

		handler := e.node.handler
		e.node.typ = ntStatic
		e.node.prefix = search[:p]
		e.node.handler = nil

		// now add the wild edge node
		search = search[p:]

		if ntyp == ntCatchAll {
			p = -1
			e.node.prefix = "**"
			goto woot
		} else {
			p = strings.IndexByte(search, '/')
		}
		if p < 0 {
			p = len(search)
		}
		e2 := edge{
			label: search[0],
			node: &node{
				typ:     ntyp,
				prefix:  search[:p],
				handler: handler,
			},
		}
		e.node.addEdge(e2)
	}

woot:

	n.edges = append(n.edges, e)
	n.edges.Sort()
}

func (n *node) replaceEdge(e edge) {
	num := len(n.edges)
	for i := 0; i < num; i++ {
		if n.edges[i].label == e.label {
			n.edges[i].node = e.node
			return
		}
	}
	panic("chi: replacing missing edge")
}

func (n *node) getEdge(label byte) *node {
	// We do a linear search as we're sorted by a compound key
	num := len(n.edges)
	for i := 0; i < num; i++ {
		if n.edges[i].label == label {
			return n.edges[i].node
		}
	}
	return nil
}

func (n *node) findEdge(minTyp nodeTyp, label byte) *node {
	num := len(n.edges)
	idx := sort.Search(num, func(i int) bool {
		if n.edges[i].node.typ < minTyp {
			return false
		}
		switch n.edges[i].node.typ {
		case ntStatic:
			return n.edges[i].label >= label
		default: // wild nodes
			// TODO: right now we match them all.. but regexp should
			// run through regexp matcher
			return true
		}
		return false
	})

	if idx >= num {
		return nil
	}

	// TODO: ... review..
	if n.edges[idx].node.typ == ntStatic && n.edges[idx].label == label {
		return n.edges[idx].node
	} else if n.edges[idx].node.typ > ntStatic { // more match logic here...?
		return n.edges[idx].node // good..? regexp..?
	}
	return nil
}

// TODO: this is a huge duplicate effort.. no good..
func (n *node) findNode(minTyp nodeTyp, path string) *node {
	nn := n
	search := path

	for {
		if len(search) == 0 {
			if nn.isLeaf() {
				return nn
			}
			break
		}

		wn := nn.findEdge(ntStatic+1, search[0]) // wild node
		nn = nn.findEdge(ntStatic, search[0])    // any node

		if nn == nil && wn == nil {
			// Found nothing at all
			break

		} else if nn == nil && wn != nil {
			// Found only a wild node
			n = wn

		} else if nn == wn {
			// Same, do nothing.

		} else if nn != nil && wn != nil {
			// Found both static and wild matching nodes

			// ..attempts to get to the final node..
			sn := nn.findNode(ntStatic, search[len(nn.prefix):])

			// As static leaf couldn't be found, use the wild node
			if sn == nil {
				log.Println("sn == nil.. dont go static route")
				nn = wn
			}
		}

		// nn = nn.findEdge(ntStatic, search[0])
		// if nn == nil {
		// 	break
		// }

		if nn.typ > ntStatic {
			// if n.prefix[0] == ':' { // .. or just check the n.typ > ntStatic ...

			// log.Printf("!!!!!!!!!!!!!!!!!!!! typ:%d", n.typ)

			p := -1
			if n.typ != ntCatchAll {
				p = strings.IndexByte(search, '/')
			}
			if p < 0 {
				p = len(search)
			}
			// if params == nil {
			// 	params = make(map[string]string, 1)
			// }
			// params[n.prefix[1:]] = search[:p]
			search = search[p:]
			continue
		}

		// Consume the search prefix
		if strings.HasPrefix(search, nn.prefix) {
			search = search[len(nn.prefix):]
		} else {
			break
		}
	}
	return nil
}

/*func (n *node) findStaticNode(path string) *node {
	sn := n
	search := path

	for {
		if len(search) == 0 {
			if sn.isLeaf() {
				return sn
			}
			break
		}

		sn = sn.findEdge(ntStatic, search[0])
		if sn == nil {
			break
		}

		// Consume the search prefix
		if strings.HasPrefix(search, sn.prefix) {
			search = search[len(sn.prefix):]
		} else {
			break
		}
	}
	return nil
}*/

type edges []edge

func (e edges) Len() int {
	return len(e)
}

// Sort the list of edges by tuple, <edge.node.typ, edge.label>
func (e edges) Less(i, j int) bool {
	if e[i].node.typ < e[j].node.typ {
		return true
	}
	if e[i].node.typ > e[j].node.typ {
		return false
	}
	return e[i].label < e[j].label
}

func (e edges) Swap(i, j int) {
	e[i], e[j] = e[j], e[i]
}

func (e edges) Sort() {
	sort.Sort(e)
}

// Tree implements a radix tree. This can be treated as a
// Dictionary abstract data type. The main advantage over
// a standard hash map is prefix-based lookups and
// ordered iteration.
type tree struct {
	root *node
}

// TODO: I suppose we can have different trees depending on the method...?
// For now, just assume method is always GET

var insertcnt int = -1

// TODO: do we return an error or panic..? what does goji do..
func (t *tree) Insert(method methodTyp, pattern string, handler Handler) error {

	insertcnt += 1
	// log.Println("")
	log.Printf("=> INSERT #%d %s\n", insertcnt, pattern)

	var parent *node
	n := t.root
	search := pattern

	iter := -1

	for {
		iter += 1

		// Handle key exhaustion
		if len(search) == 0 {
			// Insert or update the node's leaf handler
			n.handler = handler
			return nil
		}

		// Look for the edge
		parent = n
		// log.Printf("insert (%d): search[0] %s\n", iter, string(search[0]))
		n = n.getEdge(search[0])

		// if len(search) > 1 {
		// 	log.Printf("cont'd insert, search[1] %s\n", string(search[1]))
		// }

		// No edge, create one
		if n == nil {
			// log.Printf("insert (%d): new edge, prefix %s\n", iter, search)
			e := edge{
				label: search[0],
				node: &node{
					// typ:     ntStatic, // TODO: no need to specify this ..
					prefix:  search,
					handler: handler,
				},
			}
			parent.addEdge(e)

			return nil
		}

		// log.Printf("insert (%d): prefix:%s\n", iter, n.prefix)

		// Determine longest prefix of the search key on match
		commonPrefix := t.longestPrefix(search, n.prefix)
		log.Printf("insert (%d): commonPrefix '%s' + '%s'\n", iter, search[:commonPrefix], search[commonPrefix:])
		if commonPrefix == len(n.prefix) {
			search = search[commonPrefix:]
			log.Printf("insert (%d): commonPrefix == len('%s'), continue\n", iter, n.prefix)
			continue
		}

		log.Printf("=========> SPLIT NODE.......... child.prefix:%s parent.prefix:%s\n", search[:commonPrefix], parent.prefix)

		// ** TODO ** so what we gotta do is check for : or * and change the behaviour of this node splitting..

		log.Printf("****************** search[0]:%s\n", string(search[0]))

		/*switch search[0] {
		case ':': // ntParam
			// n.prefix =  ///... what..?
			// n.handler
			// parent.replaceEdge(edge{
			// 	label: search[0],
			// 	node: &node{
			// 		typ: ntParam,
			// 		prefix: search[:commonPrefix]
			// 	}
			// })

		case '*': // ntCatchAll
			log.Println("catchall.. done..")
			// parent.typ = ntCatchAll // already a catchall....?
			n.handler = handler
			return nil

		default: // ntStatic

		}*/

		// Split the node
		child := &node{
			// typ:    ntStatic, // TODO: HMM.. will this always be static...?
			prefix: search[:commonPrefix],
		}
		// log.Printf("insert (%d): split node, parentPrefix:%s, nodePrefix:%s, childPrefix:%s\n", iter, parent.prefix, n.prefix, child.prefix)
		parent.replaceEdge(edge{
			label: search[0],
			node:  child,
		})

		// Restore the existing node
		child.addEdge(edge{
			label: n.prefix[commonPrefix],
			node:  n,
		})
		n.prefix = n.prefix[commonPrefix:]

		log.Printf("=========> RESTORE NODE... child appends edge with prefix:%s\n", n.prefix)

		// If the new key is a subset, add to to this node
		search = search[commonPrefix:]
		if len(search) == 0 {
			log.Println("*** new key is a subset.. set handler, move on..")
			child.handler = handler
			return nil
		}

		// Create a new edge for the node
		// log.Printf("insert (%d): add new edge, label:%s nodePrefix:%s\n", iter, string(search[0]), search)
		child.addEdge(edge{
			label: search[0],
			node: &node{
				prefix:  search,
				handler: handler,
			},
		})
		return nil
	}
	return nil
}

func (t *tree) Find(method methodTyp, path string) (Handler, map[string]string, error) {

	var params map[string]string

	n := t.root
	search := path

	log.Printf("\n\n======> SEARCH PATH %s\n", path)

	for {
		// Check for key exhaustion
		if len(search) == 0 {
			if n.isLeaf() {
				log.Printf("** FOUND NODE for path:%s - prefix:%s typ:%d\n", path, n.prefix, n.typ)
				return n.handler, params, nil
			}
			break
		}

		// For some set of edges, we can have static and wild card nodes,
		// that will have multiple matches, but we want to first traverse the static
		// path as it takes precedence over the wild

		// TODO: we can have a numWildEdges flag on a node to avoid searching
		// for wild paths unless we have to ... or just a bool..

		log.Printf("==> SEARCH %s\n", search)

		// Look for an edge
		wn := n.findEdge(ntStatic+1, search[0]) // wild node -- will find any matching wild nodes..
		n = n.findEdge(ntStatic, search[0])     // any node

		if n == nil && wn == nil {
			// Found nothing at all
			log.Println("~~ nothing, 0 0")
			break

		} else if n == nil && wn != nil {
			log.Println("~~ 0 static, 1 wild")
			// Found only a wild node
			n = wn

		} else if n == wn {
			// same node found, likely both wild cards.
			// do nothing.
			// TODO: add more test cases...

		} else if n != nil && wn != nil {
			// Found both static and wild matching nodes
			log.Println("~~ 1 static, 1 wild")

			log.Printf("~~~~~> search:%s n.prefix:%s wn.prefix:%s\n", search, n.prefix, wn.prefix)

			// ************ TODO TODO TODO TODO TODO TODO
			// the problem is the findStaticNode ..
			// or that we have 2 wild nodes.. something is up..
			// for /admin/user//1 we should get the :id node
			// and for /admin/xxxfsdfsfd we should get the * node

			// We first look for the final leaf node by traversing the static edges
			// TODO: perhaps we can make a faster function that continues until
			// it doesnt match, instead of going all the way. It can also return
			// just a bool.
			// ie. if ok := n.hasStaticLeaf(search); !ok { n = wn }
			// sn := n.findStaticNode(search[len(n.prefix):])

			log.Printf("???? nprefix:%s search:%s search-:%s\n", n.prefix, search, search[len(n.prefix):])

			sn := n.findNode(ntStatic, search[len(n.prefix):]) // attempts to get to the final node..
			// we go down static route..

			// .. so sn will tell us if we match a static node..
			// technically, i think we're just looking for the decision
			// where the next node is static..

			// As static leaf couldn't be found, use the wild node
			if sn == nil {
				log.Println("sn == nil.. go wild")
				n = wn
			}
		}

		if n.typ > ntStatic {
			if params == nil {
				params = make(map[string]string, 1)
			}

			// if n.prefix[0] == ':' { // .. or just check the n.typ > ntStatic ...

			log.Printf("!!!!!!!!!!!!!!!!!!!! typ:%d", n.typ)

			p := -1
			if n.typ != ntCatchAll {
				p = strings.IndexByte(search, '/')
			}
			if p < 0 {
				p = len(search)
			}
			params[n.prefix[1:]] = search[:p] // TODO: catchAll, param is *
			search = search[p:]
			continue
		}

		// Consume the search prefix
		if strings.HasPrefix(search, n.prefix) {
			search = search[len(n.prefix):]
		} else {
			break
		}
	}
	return nil, params, nil
}

// Walk is used to walk the tree
func (t *tree) Walk(fn WalkFn) {
	t.recursiveWalk(t.root, fn)
}

// recursiveWalk is used to do a pre-order walk of a node
// recursively. Returns true if the walk should be aborted
func (t *tree) recursiveWalk(n *node, fn WalkFn) bool {
	// Visit the leaf values if any
	if n.handler != nil && fn(n.prefix, n.handler) { // TODO ..... walkFn() ..?
		return true
	}

	// Recurse on the children
	for _, e := range n.edges {
		if t.recursiveWalk(e.node, fn) {
			return true
		}
	}
	return false
}

// longestPrefix finds the length of the shared prefix
// of two strings
func (t *tree) longestPrefix(k1, k2 string) int {
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

//--

func WOOTrecursiveWalk(parent int, i int, n *node, label byte) bool {
	if n.handler != nil {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v handler:%v\n", i, parent, n.typ, n.prefix, string(label), len(n.edges), n.isLeaf(), n.handler)
		// return true
	} else {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v\n", i, parent, n.typ, n.prefix, string(label), len(n.edges), n.isLeaf())
	}

	parent = i
	for _, e := range n.edges {
		i++
		if WOOTrecursiveWalk(parent, i, e.node, e.label) {
			return true
		}
	}
	return false
}
