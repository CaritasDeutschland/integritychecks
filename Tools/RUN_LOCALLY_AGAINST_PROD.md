# Reassign Rocket.Chat rooms — run locally against production

How to run the `Tools` app **on your machine**, in your **browser**, while it
talks to the **production** MariaDB and Rocket.Chat. Written for the
`ReassignRCRoomsToUser` tool, which now supports consultants assigned to
**multiple agencies**.

> ⚠️ You are acting on **production data**. Always do a **dry run first** (the
> checkbox is checked by default) and only force the changes once the dry-run
> output looks correct.

These are the exact steps that worked for the `k8s-caritas-prod` cluster.

---

## 0. Prerequisites

- `kubectl` configured for the prod cluster:
  ```bash
  kubectl config current-context     # e.g. k8s-caritas-prod-admin@k8s-caritas-prod
  ```
- Node + npm (this project does **not** require `yarn` — see step 3).

---

## 1. Find where MariaDB and Rocket.Chat actually live

Service names don't contain "maria/mysql/db", and **MariaDB runs outside the
cluster**, so don't guess — read the connection info from the apps that already
use it.

**MariaDB host:port** — from the `userservice` datasource:
```bash
kubectl -n prod get deploy userservice -o yaml | grep -iE 'SPRING_DATASOURCE_URL'
# -> jdbc:mariadb://10.244.0.42:3306/userservice
```
That `10.244.0.42` is on the **node host network** (the nodes are `10.244.0.2/.3/.4`),
i.e. an external VM — there is **no pod or service** to port-forward. Confirm:
```bash
kubectl get pods -A -o wide   | grep 10.244.0.42   # -> nothing
kubectl get svc  -A -o wide   | grep 10.244.0.42   # -> nothing
```

**MariaDB credentials** — same `userservice` deployment:
```bash
kubectl -n prod get deploy userservice -o yaml \
  | grep -iE 'SPRING_DATASOURCE_USERNAME|SPRING_DATASOURCE_PASSWORD' -A2
# If these are valueFrom: secretKeyRef, read the secret:
#   kubectl -n prod get secret <name> -o jsonpath='{.data.<key>}' | base64 -d
```
(For this cluster `root` + its password works for the `userservice` and
`agencyservice` schemas the tool queries.)

**Rocket.Chat** — there *is* an in-cluster service (`svc/rocketchat`, port `3000`),
so it can be port-forwarded directly (step 2).

---

## 2. Open the port-forwards

Run each in its own terminal and leave them running.

### 2a. Rocket.Chat (direct service forward)
```bash
kubectl -n prod port-forward svc/rocketchat 49939:3000
```
Use whatever local port you like (here `49939`); put it in `ROCKETCHAT_URL`.

### 2b. MariaDB (via a socat relay pod, because the DB is external)
`kubectl port-forward` only targets pods/services, not arbitrary IPs. So run a
tiny `socat` relay pod **inside** the cluster that bridges to the external DB,
then port-forward that pod:

```bash
# 1) relay pod: local :3306 in-cluster -> 10.244.0.42:3306
kubectl -n prod run mariadb-tunnel --image=alpine/socat --restart=Never -- \
  tcp-listen:3306,fork,reuseaddr tcp-connect:10.244.0.42:3306

# 2) wait until it's ready
kubectl -n prod wait --for=condition=Ready pod/mariadb-tunnel --timeout=60s

# 3) forward the relay pod to your local 3306
kubectl -n prod port-forward pod/mariadb-tunnel 3306:3306
```

> The `mariadb-tunnel` pod is temporary — **delete it when you're done** (see
> Cleanup). If the DB IP from step 1 ever differs, update the `tcp-connect:` target.

### Verify both forwards before continuing
```bash
nc -vz 127.0.0.1 3306     # MariaDB  -> "succeeded"
nc -vz 127.0.0.1 49939    # RocketCh -> "succeeded"
```

---

## 3. Configure `.env`

```bash
cp .env.sample .env
```
Edit `.env` so it points at the **local** ends of the forwards (`127.0.0.1`),
**not** the in-cluster IPs. Only the `mysql` + `rocketchat` blocks matter for
this tool:

```ini
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=<from step 1>
MYSQL_PASSWORD=<from step 1>
MYSQL_DB=userservice

ROCKETCHAT_URL=http://127.0.0.1:49939
ROCKETCHAT_USE_SSL=false
ROCKETCHAT_USER=<rocket.chat technical/bot user>
ROCKETCHAT_PASSWORD=<its password>
```
Notes:
- The Rocket.Chat user must be the technical/bot user allowed to invite members
  into groups (the tool invites itself into each room to read members, then leaves).
- `127.0.0.1` is required — pointing `MYSQL_HOST` at the in-cluster IP
  (`10.244.0.42`) will hang on `Connect ...` because your laptop can't route to it.

### (Optional) sanity-check the DB before launching the app
```bash
node -e '
import("mysql").then(async (m)=>{(await import("dotenv")).config({path:".env"});
const c=m.default.createConnection({host:process.env.MYSQL_HOST,port:+process.env.MYSQL_PORT,
user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DB});
c.connect(e=>{console.log(e?("AUTH FAILED: "+e.code):"AUTH OK");c.end();});});'
```

---

## 4. Run the app (npm — `yarn` is not required)

`yarn` may not be installed. Use npm:

```bash
npm install                       # first time only
npm run build && npm run start    # build, then start on port 3000
```

- Re-run `npm run build && npm run start` after any code change.
- **Don't** use `npm run dev` — that script calls `yarn` internally and will fail
  unless yarn is installed.
- **Ignore** the `npm audit` "N vulnerabilities" output — those are advisories for
  the pinned old deps, not install errors. Do **not** run `npm audit fix --force`
  (it breaks the build).

A healthy startup + first request logs:
```
Tools listening on port 3000
Check config ... → Connect ... → Connected ...     # MariaDB ok
Start rocket.chat service ... → Started            # Rocket.Chat login ok
```
If it stalls on `Connect ...` with no `Connected ...`, the MariaDB forward (2b)
isn't up or `.env` is wrong.

Then open: <http://localhost:3000/user/reassignrcroomstouser>

---


## 5. Cleanup when finished

```bash
# stop the local app + port-forwards (Ctrl+C their terminals, or kill the bg pids)
kubectl -n prod delete pod mariadb-tunnel    # remove the temporary relay pod
```

---

## What changed for multiple agencies

`ReassignRCRoomsToUser` used to throw
`Multiple consultant agencies currently not supported!`. It now:

- iterates over **every active** `consultant_agency` (where `delete_date IS NULL`),
- processes each agency's sessions independently (team vs. non-team logic applied
  per agency),
- **skips** an agency that has no sessions instead of aborting, and only errors if
  **all** of the consultant's agencies are empty,
- reports counts **per agency** and as a combined total.
