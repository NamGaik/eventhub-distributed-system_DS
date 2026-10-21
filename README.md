# EventHub – Distributed Event Registration System

A small microservices application for registering students for college events, deployed with
Docker and Kubernetes to show **inter-service communication** and **scalability**.

| Component | Port | Job |
|---|---|---|
| frontend (Nginx) | 80 (3000 on your PC) | Web pages, sends `/api` requests to the gateway |
| api-gateway | 8080 | Single entry point, forwards requests, health check, load test |
| event-service | 4001 | College events and their seats |
| registration-service | 4002 | Registers and cancels, calls event-service and notification-service |
| notification-service | 4003 | Stores registration messages |
| mongo | 27017 | Database |

## What you need

- Docker Desktop (includes Docker Compose)
- Minikube and kubectl
- On Windows, use `curl.exe` instead of `curl` in PowerShell

## Part 1: Run with Docker Compose

```bash
cd eventhub
docker compose up -d --build
docker compose ps          # all 6 containers should be "running"
docker images              # shows the eventhub/* images
```

Open http://localhost:3000. Stop it with `docker compose down`.

## Part 2: Deploy on Kubernetes (Minikube)

```bash
minikube start --driver=docker

# Build the images (if you skipped Part 1) and copy them into Minikube
docker compose build
docker pull mongo:7
minikube image load eventhub/api-gateway:v1
minikube image load eventhub/event-service:v1
minikube image load eventhub/registration-service:v1
minikube image load eventhub/notification-service:v1
minikube image load eventhub/frontend:v1
minikube image load mongo:7

# Deploy: database first, then everything else
kubectl apply -f k8s/mongo.yaml
kubectl apply -f k8s/

kubectl get pods           # wait until all 6 are Running and READY 1/1
kubectl get deployments
kubectl get services
```

Open the application:

```bash
kubectl port-forward service/frontend 3000:80
```

Then open http://localhost:3000 (keep that terminal open).

Check the health of all services (in a second terminal):

```bash
kubectl port-forward service/api-gateway 8080:8080
curl http://localhost:8080/api/system/health
```

## Part 3: Scalability test

```bash
kubectl scale deployment/event-service --replicas=3
kubectl get pods -l app=event-service -o wide     # 3 event-service pods
```

In the app, open **System Status** and click **Run test**. The 12 requests are shared
between the 3 event-service pods (their names are shown). The same test from the terminal:

```bash
curl "http://localhost:8080/api/system/load-test?count=12"
```

Scale back when done:

```bash
kubectl scale deployment/event-service --replicas=1
```

## Clean up

```bash
kubectl delete -f k8s/
minikube stop
```

## Running without Docker (optional, for quick testing)

Each service can run with `npm install` and `npm start` in its folder. Without
`MONGO_URL` the services keep data in memory. Start the gateway with
`STATIC_DIR=../frontend` to also serve the web pages on http://localhost:8080.
