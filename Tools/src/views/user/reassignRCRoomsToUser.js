function disableButtonOnSubmit() {
    const button = document.getElementById('submit-button');
    if (button) {
        button.setAttribute('disabled', true);
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById("form");
    form.addEventListener("submit", disableButtonOnSubmit);
}, false);
