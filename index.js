// Scales the intro title so it fills as much of the image box as possible,
// while staying on a single line. Re-runs on resize/orientation change and
// once web fonts finish loading (font metrics affect the natural size).
//
// Approach: render the text at a fixed reference font-size, measure its
// natural (unwrapped) width/height, then compute the single scale factor
// that fits both the box's width and height, and apply it directly.
// This is a one-shot calculation, not a search — with white-space: nowrap
// there's no wrapping step to cause the rounding noise that broke the
// earlier iterative fit (it kept converging on a font-size far too small).

const REFERENCE_SIZE = 100; // px — arbitrary; only used to measure proportions
const SAFETY_MARGIN = 0.80; // leaves a hair of breathing room at the box edge

function fitTitleToBox() {
    const box = document.querySelector(".ic-Title");
    const text = document.querySelector(".tt-Fit");
    if (!box || !text) return;

    const maxWidth = box.clientWidth;
    const maxHeight = box.clientHeight;
    if (maxWidth <= 0 || maxHeight <= 0) return;

    text.style.fontSize = REFERENCE_SIZE + "px";
    const measuredWidth = text.scrollWidth;
    const measuredHeight = text.scrollHeight;
    if (measuredWidth <= 0 || measuredHeight <= 0) return;

    const scale =
        Math.min(maxWidth / measuredWidth, maxHeight / measuredHeight) *
        SAFETY_MARGIN;

    text.style.fontSize = REFERENCE_SIZE * scale + "px";
}

window.addEventListener("resize", fitTitleToBox);
window.addEventListener("orientationchange", fitTitleToBox);
window.addEventListener("load", fitTitleToBox);

if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitTitleToBox);
}

fitTitleToBox();

// Shifts the banner image to the right as the page scrolls down, over the
// first viewport height of scroll. Bounded by --img-zoom's own overscan
// margin (read from CSS, not hardcoded) so it can never shift far enough
// to reveal an edge of the source image.
const SCROLL_SHIFT_FRACTION = 0.8; // fraction of the available overscan slack used at full progress

function updateImageScrollShift() {
    const img = document.querySelector(".ic-ImageContainer img");
    const container = document.querySelector(".ic-ImageContainer");
    if (!img || !container) return;

    const zoom = parseFloat(getComputedStyle(img).getPropertyValue("--img-zoom")) || 1;
    const maxSlackPx = (container.clientWidth * (zoom - 1)) / 2;

    const progress = Math.min(Math.max(window.scrollY / window.innerHeight, 0), 1);
    const shiftPx = progress * maxSlackPx * SCROLL_SHIFT_FRACTION;

    img.style.setProperty("--img-shift-x", shiftPx + "px");
}

window.addEventListener("scroll", updateImageScrollShift, { passive: true });
window.addEventListener("resize", updateImageScrollShift);
updateImageScrollShift();

// Fades/rises each .js-reveal element into place the first time it enters
// the viewport (the "Who am I" title, divider lines, blurb, bullet list,
// and photo). Fires once per element, then stops watching it.
//
// No negative bottom rootMargin: a -10% bottom margin shrinks the
// detectable area short of the real viewport edge, which permanently
// excludes short elements near the very end of the page (e.g. the
// footer) — at max scroll they can sit entirely below that shrunk
// boundary and never intersect, so they'd stay invisible forever.
const revealTargets = document.querySelectorAll(".js-reveal");

if (revealTargets.length && "IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(
        (entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-visible");
                observer.unobserve(entry.target);
            });
        },
        { threshold: 0.2 }
    );

    revealTargets.forEach((target) => revealObserver.observe(target));
} else {
    // No IntersectionObserver support — just show everything immediately.
    revealTargets.forEach((target) => target.classList.add("is-visible"));
}

// Nav bar starts transparent over the hero, gains a background once the
// page has scrolled roughly past it.
const NAV_SCROLL_THRESHOLD = 80; // px

function updateNavBackground() {
    const nav = document.getElementById("site-nav");
    if (!nav) return;
    nav.classList.toggle("is-scrolled", window.scrollY > NAV_SCROLL_THRESHOLD);
}

window.addEventListener("scroll", updateNavBackground, { passive: true });
updateNavBackground();

// Mobile hamburger menu — toggles the dropdown panel, closes on link click,
// outside click, or Escape.
(() => {
    const nav = document.getElementById("site-nav");
    const toggle = document.getElementById("nav-toggle");
    const links = document.getElementById("nav-links");
    if (!nav || !toggle || !links) return;

    function setOpen(isOpen) {
        nav.classList.toggle("nav-open", isOpen);
        toggle.setAttribute("aria-expanded", String(isOpen));
    }

    toggle.addEventListener("click", () => {
        setOpen(!nav.classList.contains("nav-open"));
    });

    links.addEventListener("click", (event) => {
        if (event.target.tagName === "A") setOpen(false);
    });

    document.addEventListener("click", (event) => {
        if (nav.classList.contains("nav-open") && !nav.contains(event.target)) {
            setOpen(false);
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && nav.classList.contains("nav-open")) {
            setOpen(false);
        }
    });
})();

// Footer copyright year — stays correct without ever needing a manual edit.
const footerYear = document.getElementById("footer-year");
if (footerYear) {
    footerYear.textContent = new Date().getFullYear();
}

// Project detail modal — opens from a .proj-card (click or Enter/Space),
// filled in from that card's data-* attributes. Closes on the close button,
// a click on the dark overlay, or Escape. Body scroll is locked while open
// and focus returns to the card that opened it.
(() => {
    const modal = document.getElementById("project-modal");
    const modalBox = modal ? modal.querySelector(".modal-box") : null;
    const modalCloseBtn = document.getElementById("modal-close");
    const modalThumb = document.getElementById("modal-thumb");
    const modalTitle = document.getElementById("modal-title");
    const modalTags = document.getElementById("modal-tags");
    const modalDesc = document.getElementById("modal-desc");
    const modalActions = document.getElementById("modal-actions");
    const modalDemoLink = document.getElementById("modal-demo-link");
    const modalGithubLink = document.getElementById("modal-github-link");
    const projectCards = document.querySelectorAll(".proj-card");

    if (!modal || !modalBox || projectCards.length === 0) return;

    let lastFocusedCard = null;

    function openModalFor(card) {
        modalTitle.textContent = card.dataset.title || "";
        modalDesc.textContent = card.dataset.details || "";

        modalTags.innerHTML = "";
        (card.dataset.tags || "")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
            .forEach((tag) => {
                const el = document.createElement("span");
                el.className = "proj-tag";
                el.textContent = tag;
                modalTags.appendChild(el);
            });

        // Match the modal's thumbnail gradient to the clicked card's own
        // unique one, instead of always showing the same default.
        const cardThumb = card.querySelector(".proj-thumb");
        if (cardThumb) {
            modalThumb.style.backgroundImage = getComputedStyle(cardThumb).backgroundImage;
        }

        // Demo/GitHub buttons are optional per project — each one only
        // shows up if that card actually has the matching data-* URL.
        const demoUrl = card.dataset.demoUrl || "";
        const githubUrl = card.dataset.githubUrl || "";

        modalDemoLink.href = demoUrl;
        modalDemoLink.hidden = !demoUrl;

        modalGithubLink.href = githubUrl;
        modalGithubLink.hidden = !githubUrl;

        modalActions.hidden = !demoUrl && !githubUrl;

        lastFocusedCard = card;
        modal.hidden = false;
        document.body.style.overflow = "hidden";
        modalCloseBtn.focus();
    }

    function closeModal() {
        modal.hidden = true;
        document.body.style.overflow = "";
        if (lastFocusedCard) lastFocusedCard.focus();
    }

    projectCards.forEach((card) => {
        card.addEventListener("click", () => openModalFor(card));
        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openModalFor(card);
            }
        });
    });

    modalCloseBtn.addEventListener("click", closeModal);

    // Close on a click outside the box, but not on a click inside it.
    modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !modal.hidden) closeModal();
    });
})();

// Photo lightbox — click (or Enter/Space) a gallery photo to open a larger
// view, then step through the rest with the prev/next buttons or the
// left/right arrow keys. Same overlay pattern as the project modal: body
// scroll locked while open, focus returns to the thumbnail on close.
(() => {
    const overlay = document.getElementById("gallery-lightbox");
    const image = document.getElementById("lightbox-image");
    const closeBtn = document.getElementById("lightbox-close");
    const prevBtn = document.getElementById("lightbox-prev");
    const nextBtn = document.getElementById("lightbox-next");
    const photos = Array.from(document.querySelectorAll(".gallery-item"));

    if (!overlay || !image || photos.length === 0) return;

    let currentIndex = 0;
    let lastFocusedPhoto = null;

    function showPhoto(index) {
        currentIndex = (index + photos.length) % photos.length;
        const photo = photos[currentIndex];
        image.src = photo.currentSrc || photo.src;
        image.alt = photo.alt || "";
    }

    function openLightbox(index) {
        lastFocusedPhoto = photos[index];
        showPhoto(index);
        overlay.hidden = false;
        document.body.style.overflow = "hidden";
        closeBtn.focus();
    }

    function closeLightbox() {
        overlay.hidden = true;
        document.body.style.overflow = "";
        if (lastFocusedPhoto) lastFocusedPhoto.focus();
    }

    photos.forEach((photo, index) => {
        photo.addEventListener("click", () => openLightbox(index));
        photo.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openLightbox(index);
            }
        });
    });

    prevBtn.addEventListener("click", () => showPhoto(currentIndex - 1));
    nextBtn.addEventListener("click", () => showPhoto(currentIndex + 1));
    closeBtn.addEventListener("click", closeLightbox);

    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeLightbox();
    });

    document.addEventListener("keydown", (event) => {
        if (overlay.hidden) return;
        if (event.key === "Escape") closeLightbox();
        if (event.key === "ArrowLeft") showPhoto(currentIndex - 1);
        if (event.key === "ArrowRight") showPhoto(currentIndex + 1);
    });
})();

// Gallery strip prev/next buttons — page the strip by one tile's width
// instead of requiring a drag/scroll. Touch users can still swipe the
// strip directly; these buttons are hidden on small screens (see CSS).
(() => {
    const strip = document.getElementById("gallery-strip");
    const prevBtn = document.getElementById("gallery-scroll-prev");
    const nextBtn = document.getElementById("gallery-scroll-next");
    if (!strip || !prevBtn || !nextBtn) return;

    function pageStrip(direction) {
        const firstItem = strip.querySelector(".gallery-item");
        if (!firstItem) return;
        const gap = parseFloat(getComputedStyle(strip).gap) || 0;
        const step = firstItem.getBoundingClientRect().width + gap;
        strip.scrollBy({ left: direction * step, behavior: "smooth" });
    }

    prevBtn.addEventListener("click", () => pageStrip(-1));
    nextBtn.addEventListener("click", () => pageStrip(1));
})();
