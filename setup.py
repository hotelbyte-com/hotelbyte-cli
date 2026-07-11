"""
setup.py — HotelByte CLI installer.

Creates the ``hotelbyte-cli`` console entry point backed by the
``cli_anything.hotelbyte`` namespace package.  Built on the
CLI-Anything harness pattern (https://github.com/HKUDS/CLI-Anything).
"""
from setuptools import setup, find_packages

setup(
    name="cli-anything-hotelbyte",
    version="0.1.0",
    description="HotelByte CLI — agent-native interface for the OpenAPI and Tenant Portal scenarios",
    long_description=(
        "HotelByte CLI turns the HotelByte platform into an agent-native tool. "
        "Two command profiles share one binary:\n"
        "  hotelbyte-cli openapi …  — public OpenAPI (search + trade)\n"
        "  hotelbyte-cli portal …   — tenant-portal BFF (users, bookings, settings …)\n"
        "Every command supports --json for structured agent consumption."
    ),
    long_description_content_type="text/plain",
    author="HotelByte",
    license="MIT",
    packages=find_packages(),
    python_requires=">=3.9",
    install_requires=[
        "click>=8.1",
        "requests>=2.28",
    ],
    extras_require={
        "dev": ["pytest>=7.0", "pytest-cov"],
    },
    entry_points={
        "console_scripts": [
            "hotelbyte-cli=cli_anything.hotelbyte.cli:main",
        ],
    },
    classifiers=[
        "Programming Language :: Python :: 3",
        "Environment :: Console",
        "Intended Audience :: Developers",
        "Topic :: Internet :: WWW/HTTP",
    ],
)