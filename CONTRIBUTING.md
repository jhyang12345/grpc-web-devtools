# How to contribute

**Working on your first Pull Request?** You can learn how from this *free* series [How to Contribute to an Open Source Project on GitHub](https://egghead.io/series/how-to-contribute-to-an-open-source-project-on-github)

## Guidelines for Pull Requests

How to get your contributions merged smoothly and quickly.

* Create **small PRs** that are narrowly focused on **addressing a single concern**. We often times receive PRs that are trying to fix several things at a time, but only one fix is considered acceptable, nothing gets merged and both author's & review's time is wasted. Create more PRs to address different concerns and everyone will be happy.

* For speculative changes, consider opening an issue and discussing it first.

* Provide a good **PR description** as a record of **what** change is being made and **why** it was made. Link to a github issue if it exists.

* Unless your PR is trivial, you should expect there will be reviewer comments that you'll need to address before merging. We expect you to be reasonably responsive to those comments, otherwise the PR will be closed after 2-3 weeks of inactivity.

* Maintain **clean commit history** and use **meaningful commit messages**. PRs with messy commit history are difficult to review and won't be merged. Use `rebase -i upstream/master` to curate your commit history and/or to bring in latest changes from master (but avoid rebasing in the middle of a code review).

* Keep your PR up to date with upstream/master (if there are merge conflicts, we can't really merge your change).

* Exceptions to the rules can be made if there's a compelling reason for doing so.

## Running the tests

* `npm test` runs every suite: the fast unit suites plus the real-library
  end-to-end matrix. It first installs the isolated Connect-ES v1 runtime in
  `e2e/connect-v1` if needed.
* `npm run test:e2e` runs only the end-to-end matrix. It drives real generated
  grpc-web (text and binary, callback and promise clients), Connect-ES v1 and v2
  (gRPC-Web and Connect protocols), and protobuf-ts clients against an in-process
  server. The traffic flows through the real content script, background worker
  and React panel.
* `npm run e2e:generate` regenerates the fixture client code from
  `e2e/proto/kitchen.proto` with `buf` (remote BSR plugins).

See `docs/plans/2026-09-24-full-feature-test-plan.md` for the coverage matrix.
