(function () {
  var nav = document.querySelector('nav');
  if (!nav) return;
  var links = nav.querySelector('.nav-links');
  if (!links) return;

  var btn = document.createElement('button');
  btn.className = 'nav-hamburger';
  btn.setAttribute('aria-label', 'Toggle menu');
  btn.innerHTML = '<span></span><span></span><span></span>';

  btn.addEventListener('click', function () {
    var open = links.classList.toggle('is-open');
    btn.classList.toggle('is-open', open);
  });

  // Close on link click
  links.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      links.classList.remove('is-open');
      btn.classList.remove('is-open');
    });
  });

  nav.appendChild(btn);
})();
