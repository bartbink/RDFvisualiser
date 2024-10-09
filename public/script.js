const socket = io();
let network;
let classData, objectData;
let currentView = 'class';

socket.on('initialRDF', (data) => {
    document.getElementById('turtleInput').value = data;
    updateGraph();
});

function updateGraph() {
    const turtleData = document.getElementById('turtleInput').value;
    console.log("Sending RDF data to server:", turtleData);
    socket.emit('updateRDF', turtleData);
}

function resetGraph() {
    if (network) {
        network.fit();
    }
}

function toggleView() {
    currentView = currentView === 'class' ? 'object' : 'class';
    document.getElementById('toggleView').textContent = `Switch to ${currentView === 'class' ? 'Object' : 'Class'} View`;
    drawGraph();
}

function drawGraph() {
    const container = document.getElementById('mynetwork');
    const data = currentView === 'class' ? classData : objectData;
    const options = {
        nodes: {
            shape: 'box',
            margin: 5,
            widthConstraint: { minimum: 150, maximum: 300 },
            color: {
                border: '#8B0000',
                background: '#FFFACD'
            }
        },
        edges: {
            smooth: {
                type: 'cubicBezier',
                forceDirection: 'vertical',
                roundness: 0.4
            },
            font: {
                size: 12,
                face: 'arial',
                multi: true,
                bold: {
                    color: '#black',
                    size: 12,
                    vadjust: 5
                }
            }
        },
        layout: {
            hierarchical: {
                direction: 'UD',
                sortMethod: 'directed',
                levelSeparation: 200,
                nodeSpacing: 200
            }
        },
        physics: false
    };
    network = new vis.Network(container, data, options);

    // Custom drawing for separator line rendering
    network.on("afterDrawing", function (ctx) {
        const nodePositions = network.getPositions();
        for (let nodeId in nodePositions) {
            const nodeDetails = this.body.nodes[nodeId];
            if (nodeDetails) {
                const { x, y } = nodePositions[nodeId];
                const width = nodeDetails.shape.width;
                const height = nodeDetails.shape.height;

                ctx.strokeStyle = '#8B0000';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(x - width / 2 + 5, y - height / 2 + 25);
                ctx.lineTo(x + width / 2 - 5, y - height / 2 + 25);
                ctx.stroke();
            }
        }
    });
}

socket.on('graphData', (quads) => {
    console.log("Received graph data:", quads);
    const classNodes = new vis.DataSet();
    const classEdges = new vis.DataSet();
    const objectNodes = new vis.DataSet();
    const objectEdges = new vis.DataSet();

    const classes = new Map();
    const properties = new Map();
    const instances = new Map();
    const shapes = new Map();


    // First pass: Collect classes, properties, instances, and shapes
    quads.forEach((quad) => {
        if (quad.predicate.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
            if (quad.object.value === 'http://www.w3.org/2000/01/rdf-schema#Class' &&
                quad.subject.value !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property') {
                classes.set(quad.subject.value, { properties: [], relations: [] });
            } else if (quad.object.value === 'http://www.w3.org/ns/shacl#NodeShape') {
                shapes.set(quad.subject.value, { properties: [] });
            } else if (quad.object.value !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property') {
                instances.set(quad.subject.value, { type: quad.object.value, properties: [], relations: [] });
                if (!classes.has(quad.object.value)) {
                    classes.set(quad.object.value, { properties: [], relations: [] });
                }
            }
        } else if (quad.predicate.value === 'http://www.w3.org/2000/01/rdf-schema#range') {
            if (!properties.has(quad.subject.value)) {
                properties.set(quad.subject.value, {});
            }
            properties.get(quad.subject.value).range = quad.object.value;
        } else if (quad.predicate.value === 'http://www.w3.org/ns/shacl#targetClass') {
            shapes.get(quad.subject.value).targetClass = quad.object.value;
        } else if (quad.predicate.value === 'http://www.w3.org/ns/shacl#property') {
            shapes.get(quad.subject.value).properties.push(quad.object.value);
        }
    });

    // Process SHACL shapes
    quads.forEach((quad) => {
        if (quad.predicate.value === 'http://www.w3.org/ns/shacl#path') {
            const shape = Array.from(shapes.values()).find(s => s.properties.includes(quad.subject.value));
            if (shape) {
                const property = properties.get(quad.object.value) || {};
                property.shapeInfo = { shape: shape.targetClass, propertyShape: quad.subject.value };
                properties.set(quad.object.value, property);
            }
        } else if (quad.predicate.value === 'http://www.w3.org/ns/shacl#minCount') {
            const property = Array.from(properties.values()).find(p => p.shapeInfo && p.shapeInfo.propertyShape === quad.subject.value);
            if (property) {
                property.shapeInfo.minCount = parseInt(quad.object.value);
            }
        } else if (quad.predicate.value === 'http://www.w3.org/ns/shacl#maxCount') {
            const property = Array.from(properties.values()).find(p => p.shapeInfo && p.shapeInfo.propertyShape === quad.subject.value);
            if (property) {
                property.shapeInfo.maxCount = parseInt(quad.object.value);
            }
        }
    });

    // Second pass: Process properties and relations
    quads.forEach((quad) => {
        if (quad.predicate.value === 'http://www.w3.org/2000/01/rdf-schema#domain') {
            const property = properties.get(quad.subject.value) || {};
            const classInfo = classes.get(quad.object.value);
            if (classInfo) {
                const propertyName = quad.subject.value.split('/').pop().split('#').pop();
                if (property.range && classes.has(property.range)) {
                    // This is a relation to another class
                    const cardinality = property.shapeInfo ?
                        `${property.shapeInfo.minCount || 0}..${property.shapeInfo.maxCount || '*'}` : '';
                    classInfo.relations.push({ name: propertyName, target: property.range, cardinality });
                } else {
                    // This is a property
                    let propertyString = `${propertyName}:`;
                    if (property.range) {
                        const rangeName = property.range.split('/').pop().split('#').pop();
                        propertyString += ` <${rangeName}>`;
                    }
                    if (property.shapeInfo) {
                        propertyString += ` [${property.shapeInfo.minCount || 0}..${property.shapeInfo.maxCount || '*'}]`;
                    }
                    classInfo.properties.push(propertyString);
                }
            }
        } else if (instances.has(quad.subject.value) && quad.predicate.value !== 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
            const instanceInfo = instances.get(quad.subject.value);
            if (instances.has(quad.object.value)) {
                instanceInfo.relations.push({ name: quad.predicate.value, target: quad.object.value });
            } else {
                instanceInfo.properties.push(`${quad.predicate.value.split('/').pop().split('#').pop()}: ${quad.object.value}`);
            }
        }
    });

    function addNode(nodes, id, label, properties, color) {
        const propertyString = properties.length > 0 ? properties.join('\n') : '';
        const labelParts = label.split('/').pop().split('#').pop().split('_');
        const formattedLabel = labelParts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
        nodes.add({
            id: id,
            label: `<b>${formattedLabel}</b>\n\n${propertyString}`,
            color: color,
            shapeProperties: {
                borderDashes: false
            },
            font: {
                multi: 'html',
                align: 'left',
                bold: {
                    color: 'black',
                    size: 14,
                    vadjust: 0
                },
                normal: {
                    color: 'black',
                    size: 12,
                    vadjust: 0
                }
            }
        });
    }

    // Update the edge creation part in the class nodes and edges section
    classes.forEach((classInfo, classId) => {
        addNode(classNodes, classId, classId, classInfo.properties, { background: '#FFFACD', border: '#8B0000' });

        classInfo.relations.forEach(relation => {
            if (classes.has(relation.target)) {
                classEdges.add({
                    from: classId,
                    to: relation.target,
                    label: `${relation.name}\n<b>[${relation.cardinality}]</b>`, // HTML formatting
                    arrows: {
                        to: {
                            enabled: true,
                            type: 'arrow'
                        }
                    },
                    color: { color: '#8B0000' },
                    font: {
                        color: 'black',
                        size: 12,
                        face: 'arial',
                        multi: 'html', // Enable HTML formatting
                        align: 'horizontal'
                    },
                    smooth: {
                        type: 'cubicBezier',
                        forceDirection: 'vertical',
                        roundness: 0.4
                    }
                });
            }
        });
    });

    // Add object nodes and edges (unchanged)
    instances.forEach((instanceInfo, instanceId) => {
        addNode(objectNodes, instanceId, instanceId, instanceInfo.properties, { background: '#FAFAD2', border: '#8B0000' });

        instanceInfo.relations.forEach(relation => {
            objectEdges.add({
                from: instanceId,
                to: relation.target,
                label: relation.name.split('/').pop().split('#').pop(),
                arrows: 'to',
                color: { color: '#8B0000' },
                font: { color: 'black', size: 12 }
            });
        });
    });

    classData = { nodes: classNodes, edges: classEdges };
    objectData = { nodes: objectNodes, edges: objectEdges };

    drawGraph();
});

socket.on('error', (error) => {
    console.error("Received error from server:", error);
    alert("Error processing RDF data: " + error);
});

document.getElementById('updateGraph').addEventListener('click', updateGraph);
document.getElementById('resetView').addEventListener('click', resetGraph);
document.getElementById('toggleView').addEventListener('click', toggleView);