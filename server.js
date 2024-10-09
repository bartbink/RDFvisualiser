const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const N3 = require('n3');
const fs = require('fs').promises;
const path = require('path');

app.use(express.static('public'));

const RDF_FILE = path.join(__dirname, 'rdf_data.ttl');

io.on('connection', async (socket) => {
    console.log('A user connected');

    try {
        const existingData = await fs.readFile(RDF_FILE, 'utf8');
        socket.emit('initialRDF', existingData);
    } catch (error) {
        console.error('Error reading RDF file:', error);
        socket.emit('initialRDF', '');
    }

    socket.on('updateRDF', async (turtleData) => {
        console.log("Received RDF data from client:", turtleData);
        const parser = new N3.Parser();
        const quads = [];

        parser.parse(turtleData, (error, quad, prefixes) => {
            if (error) {
                console.error("Error parsing RDF:", error);
                socket.emit('error', "Error parsing RDF: " + error.message);
                return;
            }
            if (quad)
                quads.push(quad);
            else {
                console.log("Parsed quads:", quads);
                socket.emit('graphData', quads);
                fs.writeFile(RDF_FILE, turtleData)
                    .catch(err => console.error('Error writing to RDF file:', err));
            }
        });
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});