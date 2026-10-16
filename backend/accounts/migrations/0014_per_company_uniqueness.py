"""H30 plan §2.6 step 5 — per-company uniqueness on accounts internals (R2).

Two global unique constraints flip to per-company, because what they keyed is
company-internal numbering, not world-wide identity:

* ``Department.code`` (was ``unique=True``): two companies may both run a
  department coded "SALES". Becomes UniqueConstraint(company, code).
* ``EmployeeProfile.employee_number`` (was ``unique=True``): employee #E-1 in
  company A no longer blocks E-1 in company B. Becomes
  UniqueConstraint(company, employee_number) CONDITIONED on the number being
  set at all (nullable column: multiple unset numbers per company coexist).

``User.email`` uniqueness stays GLOBAL on purpose: email is the login
identity (USERNAME_FIELD) and one person is one account across companies.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0013_tenant_fk_hard"),
    ]

    operations = [
        migrations.AlterField(
            model_name="department",
            name="code",
            field=models.CharField(max_length=32),
        ),
        migrations.AlterField(
            model_name="employeeprofile",
            name="employee_number",
            field=models.CharField(blank=True, max_length=32, null=True),
        ),
        migrations.AddConstraint(
            model_name="department",
            constraint=models.UniqueConstraint(fields=("company", "code"), name="uniq_department_company_code"),
        ),
        migrations.AddConstraint(
            model_name="employeeprofile",
            constraint=models.UniqueConstraint(
                condition=models.Q(("employee_number__isnull", False)),
                fields=("company", "employee_number"),
                name="uniq_employeeprofile_company_employee_number",
            ),
        ),
    ]
