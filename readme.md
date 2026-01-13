# MET Catalogue Maker (MCB)

A small web app that pulls artworks from The Met Collection API, lays them out like a Pinterest wall, and lets you generate and print a catalogue.

The app runs on a lightweight Node server so images can be safely proxied and loaded reliably across devices.

---

## What you need installed

1) **Node.js** 
Check with:
(in terminal)
node -v
npm (comes bundled with Node)
Check with:
(in terminal)
npm -v


## Installation (recommended) ##

An installer script is included to set everything up automatically.

From the project root (the folder containing server.js), run:

chmod +x install.sh
./install.sh

## Running the project ##
After installation, start the app with:

npm run dev

You should see a message like:

MCB server running → http://localhost:3000
Health check → http://localhost:3000/health

# Open the app in your browser: #

http://localhost:3000