## Prerequests

1. Installed and working Go environment
2. Download the sources:

```bash
go get -d github.com/pressly/chi
cd $GOPATH/src/github.com/pressly/chi
```

3. Now you should be able to run `make`, `make fmt`.

## Submitting a Pull request

Your typical workflow will be:

1. [Fork the repository.][fork]. [This tip maybe also helpful][go-fork-tip]
2. [Create a topic branch.][branch]
3. Add tests for your change.
4. Run `make`. If you tests pass, return to the step 3.
5. Implement the change and ensure the steps from the previous step pass.
6. Run `make fmt`, to ensure the new code conforms to Go formatting guidline.
7. [Add, commit and push your changes][git-help]. 
8. [Submit a pull request.][pull-req]


[go-fork-tip]: http://blog.campoy.cat/2014/03/github-and-go-forking-pull-requests-and.html 
[fork]: https://help.github.com/articles/fork-a-repo
[branch]: http://learn.github.com/p/branching.html
[git-help]: https://guides.github.com
[pull-req]: https://help.github.com/articles/using-pull-requests
