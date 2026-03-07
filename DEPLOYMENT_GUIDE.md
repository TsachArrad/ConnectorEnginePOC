# Complete Deployment Guide: Ubuntu + SSH + FastAPI Application

## Part 1: Install Ubuntu on Windows (Using WSL2)

### Step 1: Enable WSL2 on Windows

1. Open **PowerShell as Administrator** (Right-click Start menu → Windows PowerShell (Admin))

2. Run these commands one by one:

```powershell
# Enable WSL
wsl --install

# This will install Ubuntu by default and restart your computer
```

3. **Restart your computer** when prompted

4. After restart, Ubuntu will automatically open and ask you to create a username and password:
   - Choose a username (lowercase, no spaces): e.g., `myuser`
   - Choose a password (you won't see it while typing)
   - Remember these credentials!

### Step 2: Update Ubuntu

Once Ubuntu is installed, run:

```bash
sudo apt update && sudo apt upgrade -y
```

---

## Part 2: Install Required Software on Ubuntu

### Step 1: Install Python 3.11+

```bash
# Install Python and pip
sudo apt install -y python3 python3-pip python3-venv

# Verify installation
python3 --version
```

### Step 2: Install Docker (Required for your app)

```bash
# Install Docker
sudo apt install -y docker.io

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add your user to docker group (so you don't need sudo)
sudo usermod -aG docker $USER

# Apply group changes
newgrp docker

# Verify Docker installation
docker --version
```

### Step 3: Install Git

```bash
sudo apt install -y git
```

---

## Part 3: Setup SSH Access

### Option A: Access Ubuntu from Windows Terminal (Easiest)

You can access your Ubuntu directly from Windows:

1. Open **Windows Terminal** or **PowerShell**
2. Type: `wsl` or `ubuntu`
3. You're now in Ubuntu!

### Option B: Setup SSH Server (For remote access)

If you want to SSH into Ubuntu like a remote server:

```bash
# Install OpenSSH Server
sudo apt install -y openssh-server

# Start SSH service
sudo service ssh start

# Get your IP address
ip addr show eth0 | grep inet

# Enable SSH to start on boot
sudo systemctl enable ssh
```

To connect via SSH from Windows:
```powershell
# From PowerShell or CMD
ssh your_username@localhost
# Or use the IP address you got from ip addr command
```

---

## Part 4: Deploy Your FastAPI Application

### Step 1: Create Project Directory

```bash
# Create a directory for your project
mkdir -p ~/projects
cd ~/projects
```

### Step 2: Transfer Your Code to Ubuntu

**Method 1: Using File Explorer (Easiest)**

1. Open Windows File Explorer
2. In the address bar, type: `\\wsl$\Ubuntu\home\your_username\projects`
3. You can now drag and drop your `pocs` folder here

**Method 2: Using Git (if you have a repository)**

```bash
cd ~/projects
git clone your-repository-url
cd pocs
```

**Method 3: Using WSL path from Windows**

Your Windows C: drive is accessible in Ubuntu at `/mnt/c/`

```bash
# Copy from Windows to Ubuntu
cp -r /mnt/c/Users/User/pocs ~/projects/
cd ~/projects/pocs
```

### Step 3: Setup Python Virtual Environment

```bash
cd ~/projects/pocs

# Create virtual environment
python3 -m venv .venv

# Activate virtual environment
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### Step 4: Configure Environment Variables

Your `.env` file should already be in the project. Verify it exists:

```bash
cat .env
```

If not, create it:

```bash
nano .env
```

Paste your environment variables and save (Ctrl+X, then Y, then Enter).

### Step 5: Test Docker Access

```bash
# Pull Python image (used by your app)
docker pull python:3.13-slim

# Verify it works
docker images
```

---

## Part 5: Run Your Application

### Method 1: Run Directly (For Testing)

```bash
# Make sure you're in the project directory with venv activated
cd ~/projects/pocs
source .venv/bin/activate

# Run the application
python -m app.main
```

Your app will be available at: `http://localhost:8000`

### Method 2: Run with Uvicorn (Production-like)

```bash
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Method 3: Run as Background Service (Stays running)

Create a systemd service file:

```bash
sudo nano /etc/systemd/system/fastapi-app.service
```

Paste this content (replace `your_username` with your actual username):

```ini
[Unit]
Description=FastAPI Application
After=network.target

[Service]
Type=simple
User=your_username
WorkingDirectory=/home/your_username/projects/pocs
Environment="PATH=/home/your_username/projects/pocs/.venv/bin"
ExecStart=/home/your_username/projects/pocs/.venv/bin/python -m app.main
Restart=always

[Install]
WantedBy=multi-user.target
```

Save and enable the service:

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable fastapi-app

# Start the service
sudo systemctl start fastapi-app

# Check status
sudo systemctl status fastapi-app

# View logs
sudo journalctl -u fastapi-app -f
```

---

## Part 6: Access Your Application

### From Windows Browser

1. Open your browser
2. Go to: `http://localhost:8000/health`
3. You should see: `{"status": "ok"}`

### API Documentation

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

---

## Common Commands Cheat Sheet

### Starting/Stopping Ubuntu

```powershell
# From Windows PowerShell
wsl                          # Start Ubuntu
wsl --shutdown              # Stop Ubuntu
wsl --list --verbose        # List installed distributions
```

### Managing Your Application

```bash
# Start the service
sudo systemctl start fastapi-app

# Stop the service
sudo systemctl stop fastapi-app

# Restart the service
sudo systemctl restart fastapi-app

# View logs
sudo journalctl -u fastapi-app -f

# Check if running
sudo systemctl status fastapi-app
```

### Docker Commands

```bash
# List running containers
docker ps

# List all containers
docker ps -a

# Stop all containers
docker stop $(docker ps -q)

# Remove all containers
docker rm $(docker ps -aq)

# View Docker logs
docker logs <container-id>
```

### Virtual Environment

```bash
# Activate
source .venv/bin/activate

# Deactivate
deactivate

# Install new package
pip install package-name

# Update requirements.txt
pip freeze > requirements.txt
```

---

## Troubleshooting

### Issue: "docker: command not found"

```bash
# Check if Docker is running
sudo systemctl status docker

# Start Docker
sudo systemctl start docker
```

### Issue: "Permission denied" for Docker

```bash
# Add yourself to docker group
sudo usermod -aG docker $USER

# Log out and log back in, or run:
newgrp docker
```

### Issue: Port 8000 already in use

```bash
# Find what's using port 8000
sudo lsof -i :8000

# Kill the process (replace PID with actual process ID)
kill -9 PID

# Or change the port in your app
export PORT=8001
python -m app.main
```

### Issue: Can't access from Windows browser

```bash
# Make sure the app is listening on 0.0.0.0, not 127.0.0.1
# Check your main.py uvicorn.run() configuration
```

### Issue: WSL2 doesn't have internet

```powershell
# From Windows PowerShell (as Admin)
wsl --shutdown
# Then restart WSL
```

---

## Quick Start Summary

Once everything is set up, here's your daily workflow:

```bash
# 1. Open Windows Terminal and type:
wsl

# 2. Navigate to your project:
cd ~/projects/pocs

# 3. Activate virtual environment:
source .venv/bin/activate

# 4. Start your application:
python -m app.main

# Or if using systemd service:
sudo systemctl start fastapi-app
```

Done! Your app is running on `http://localhost:8000`

---

## Next Steps

1. ✅ Set up automatic backups
2. ✅ Configure firewall rules (if exposing to network)
3. ✅ Set up monitoring/logging
4. ✅ Consider using Nginx as reverse proxy
5. ✅ Set up SSL certificates for HTTPS

---

## Additional Resources

- WSL2 Documentation: https://docs.microsoft.com/en-us/windows/wsl/
- FastAPI Documentation: https://fastapi.tiangolo.com/
- Docker Documentation: https://docs.docker.com/
- Ubuntu Server Guide: https://ubuntu.com/server/docs

---

## Need Help?

Common issues and their solutions:

1. **Forgot Ubuntu password**: Run `wsl --user root` then `passwd your_username`
2. **WSL won't start**: Run `wsl --shutdown` and try again
3. **Application errors**: Check logs with `sudo journalctl -u fastapi-app -f`
4. **Docker errors**: Ensure Docker service is running: `sudo systemctl status docker`
