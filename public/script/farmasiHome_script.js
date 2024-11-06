    function setRackStatus(rackNumber) {
        const button = document.getElementById(`button-${rackNumber}`);
        const currentClass = button.className;

        // Toggle between empty, needs-fill, and occupied states
        if (currentClass === "button-empty") {
            button.className = "button-needs-fill";
        } else if (currentClass === "button-needs-fill") {
            button.className = "button-occupied";
        } else {
            button.className = "button-empty";
        }
    }

    // Initialize buttons with "empty" status by default
    document.querySelectorAll(".button-container button").forEach(button => {
        button.className = "button-empty";
    });
