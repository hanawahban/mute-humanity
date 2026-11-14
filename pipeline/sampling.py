"""Which dates/months a year is sampled on, per sources.yaml."""
import calendar
import datetime as dt


def plan_dates(year, sampling, today=None):
    """Dates to sample in `year` for daily products (days_per_month + days)."""
    today = today or dt.date.today()
    days = sampling.get("days")
    n = sampling.get("days_per_month")
    out = []
    for m in range(1, 13):
        last = calendar.monthrange(year, m)[1]
        if days:
            picks = [d for d in days if d <= last][: n or len(days)]
        else:  # n evenly spaced days, or all
            k = n or last
            picks = sorted({round(1 + i * (last - 1) / max(k - 1, 1)) for i in range(k)}) if n else list(range(1, last + 1))
        out += [dt.date(year, m, d) for d in picks]
    return [d for d in out if d <= today]


def plan_months(year, sampling, today=None):
    """Months to sample for monthly products. months: 'all' or a list."""
    today = today or dt.date.today()
    months = sampling.get("months", "all")
    months = list(range(1, 13)) if months == "all" else list(months)
    return [dt.date(year, m, 1) for m in months if dt.date(year, m, 1) <= today]


def year_range(years, today=None):
    today = today or dt.date.today()
    start, end = years
    return list(range(start, (end or today.year) + 1))


def is_partial(year, today=None):
    today = today or dt.date.today()
    return year == today.year
