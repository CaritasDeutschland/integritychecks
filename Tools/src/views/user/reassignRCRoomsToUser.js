function disableOnClick() {
    document.getElementById('submit-button').setAttribute('disabled', true);
}

document.addEventListener('DOMContentLoaded', function () {
    console.log(document.getElementById('submit-button'));
    document.getElementById('submit-button').addEventListener('click', disableOnClick);
}, false);